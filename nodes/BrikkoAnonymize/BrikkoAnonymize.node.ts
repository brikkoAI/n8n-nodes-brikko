import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import { AnonymizerClient } from "../../lib/anonymizer-client";
import {
	BrikkoConfigError,
	BrikkoRequestError,
	BrikkoUnavailableError,
} from "../../lib/errors";
import { resolveBackend, type RuntimeMode } from "../../lib/modes";
import {
	MODE_PROPERTY,
	POLICY_PROPERTY,
	WORKSPACE_PROPERTY,
} from "../../lib/node-shared";
import { regexMask } from "../../lib/regex-fallback";
import { newRequestId } from "../../lib/request-id";
import type {
	BrikkoAnonymizeOutput,
	PolicyProfileName,
} from "../../lib/types";

export class BrikkoAnonymize implements INodeType {
	description: INodeTypeDescription = {
		displayName: "Brikko Anonymize",
		name: "brikkoAnonymize",
		icon: "file:brikko.svg",
		group: ["transform"],
		version: 1,
		subtitle: '={{ "policy: " + $parameter["policyProfile"] }}',
		description:
			"Mask Russian and English PII (name, phone, email, INN, SNILS, " +
			"card, IP) before sending text to an LLM.",
		defaults: { name: "Brikko Anonymize" },
		inputs: ["main"],
		outputs: ["main"],
		credentials: [
			{ name: "brikkoApi", required: false },
			{ name: "brikkoLocalApi", required: false },
		],
		properties: [
			MODE_PROPERTY,
			{
				displayName: "Text / Текст",
				name: "text",
				type: "string",
				typeOptions: { rows: 4 },
				default: "={{ $json.text }}",
				required: true,
				description:
					"Text to anonymize. Use n8n expressions to pull from a field, " +
					"e.g. {{ $json.message }}. " +
					"Текст для анонимизации.",
			},
			POLICY_PROPERTY,
			WORKSPACE_PROPERTY,
			{
				displayName: "Output Field / Поле результата",
				name: "outputField",
				type: "string",
				default: "brikko",
				description:
					"Name of the field to write the result to. " +
					"Имя поля для результата.",
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		const local = await safeCred(this, "brikkoLocalApi");
		const api = await safeCred(this, "brikkoApi");

		for (let i = 0; i < items.length; i++) {
			try {
				const mode = this.getNodeParameter("mode", i) as RuntimeMode;
				const text = this.getNodeParameter("text", i) as string;
				const policy = this.getNodeParameter(
					"policyProfile",
					i,
				) as PolicyProfileName;
				const wsOverride = this.getNodeParameter(
					"workspaceId",
					i,
				) as string;
				const outField = this.getNodeParameter(
					"outputField",
					i,
				) as string;

				if (typeof text !== "string" || text.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						"Text is empty — set the Text property to an expression " +
							"like {{ $json.message }}.",
						{ itemIndex: i },
					);
				}

				const backend = await resolveBackend({
					mode,
					local: local
						? {
								url: local.url as string,
								workspaceId: local.workspaceId as string,
							}
						: undefined,
					api: api
						? {
								apiKey: api.apiKey as string,
								baseUrl: api.baseUrl as string,
							}
						: undefined,
					workspaceId: wsOverride,
				});

				let result: BrikkoAnonymizeOutput;
				const requestId = newRequestId();

				if (backend.kind === "regex") {
					const t0 = Date.now();
					const r = regexMask(text);
					result = {
						masked_text: r.masked_text,
						mapping_id: requestId,
						entities: r.entities.map((e) => ({
							placeholder: e.placeholder,
							category: e.category,
							confidence: 0.7,
						})),
						policy,
						source: "regex",
						latency_ms: Date.now() - t0,
					};
				} else {
					const client = backend.client as AnonymizerClient;
					const resp = await client.anonymize({
						workspace_id: backend.workspaceId,
						text,
						policy_profile: policy,
						session_id: "n8n",
						request_id: requestId,
					});
					result = {
						masked_text: resp.masked_text,
						mapping_id: resp.request_id,
						entities: resp.entities,
						policy,
						source: backend.kind,
						latency_ms: resp.latency_ms,
					};
				}

				out.push({
					json: { ...items[i].json, [outField]: result },
					pairedItem: { item: i },
				});
			} catch (err: unknown) {
				if (this.continueOnFail()) {
					out.push({
						json: { ...items[i].json, error: errMsg(err) },
						pairedItem: { item: i },
					});
					continue;
				}
				throw wrap(err, this, i);
			}
		}

		return [out];
	}
}

async function safeCred(
	ctx: IExecuteFunctions,
	name: string,
): Promise<Record<string, unknown> | null> {
	try {
		return (await ctx.getCredentials(name)) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function errMsg(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

function wrap(
	err: unknown,
	ctx: IExecuteFunctions,
	itemIndex: number,
): Error {
	const node = ctx.getNode();
	if (
		err instanceof BrikkoUnavailableError ||
		err instanceof BrikkoRequestError ||
		err instanceof BrikkoConfigError
	) {
		return new NodeOperationError(node, err.message, { itemIndex });
	}
	if (err instanceof Error) {
		return new NodeOperationError(node, err.message, { itemIndex });
	}
	return new NodeOperationError(node, String(err), { itemIndex });
}
