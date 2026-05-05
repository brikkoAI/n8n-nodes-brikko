import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import {
	BrikkoConfigError,
	BrikkoRequestError,
	BrikkoUnavailableError,
} from "../../lib/errors";
import { resolveBackend, type RuntimeMode } from "../../lib/modes";
import { MODE_PROPERTY, WORKSPACE_PROPERTY } from "../../lib/node-shared";
import {
	regexRestore,
	type RegexEntity,
} from "../../lib/regex-fallback";
import type { BrikkoRestoreOutput } from "../../lib/types";

export class BrikkoRestore implements INodeType {
	description: INodeTypeDescription = {
		displayName: "Brikko Restore",
		name: "brikkoRestore",
		icon: "file:brikko.svg",
		group: ["transform"],
		version: 1,
		description:
			"Restore original PII in a previously masked text using the " +
			"mapping_id from Brikko Anonymize.",
		defaults: { name: "Brikko Restore" },
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
					"Masked text containing placeholders like <NAME_001>. " +
					"Маскированный текст с плейсхолдерами.",
			},
			{
				displayName: "Mapping ID / ID маппинга",
				name: "mappingId",
				type: "string",
				default:
					"={{ $json.brikko && $json.brikko.mapping_id }}",
				required: true,
				description:
					"Returned by Brikko Anonymize as `mapping_id`. " +
					"Возвращается узлом Brikko Anonymize.",
			},
			{
				displayName: "Regex Entities (Offline Mode) / Сущности (офлайн)",
				name: "regexEntities",
				type: "json",
				default:
					"={{ $json.brikko && $json.brikko.entities }}",
				description:
					"Required only when Mode = Regex Only — the entity list " +
					"emitted by Anonymize is needed to invert the masking. " +
					"Required только в режиме Regex Only.",
			},
			WORKSPACE_PROPERTY,
			{
				displayName: "Output Field / Поле результата",
				name: "outputField",
				type: "string",
				default: "brikko_restored",
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
				const mappingId = this.getNodeParameter(
					"mappingId",
					i,
				) as string;
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
						"Text is empty.",
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

				let result: BrikkoRestoreOutput;

				if (backend.kind === "regex") {
					const entities = this.getNodeParameter(
						"regexEntities",
						i,
					) as unknown;
					const list = normalizeEntities(entities);
					const t0 = Date.now();
					const r = regexRestore(text, list);
					result = {
						restored_text: r.restored_text,
						hallucinated: r.hallucinated,
						source: "regex",
						latency_ms: Date.now() - t0,
					};
				} else {
					if (!mappingId) {
						throw new NodeOperationError(
							this.getNode(),
							"Mapping ID is required when calling Studio or Gateway.",
							{ itemIndex: i },
						);
					}
					const resp = await backend.client.restore({
						workspace_id: backend.workspaceId,
						text,
						request_id: mappingId,
					});
					result = {
						restored_text: resp.restored_text,
						hallucinated: resp.hallucinated.map((h) => h.placeholder),
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

/**
 * Coerce whatever the user passed in `regexEntities` into a usable list.
 * n8n expressions can yield: undefined, null, a single object, an array,
 * or a JSON string. We accept all four.
 */
function normalizeEntities(input: unknown): RegexEntity[] {
	if (input == null) return [];
	if (typeof input === "string") {
		try {
			input = JSON.parse(input);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(input)) return [];
	const out: RegexEntity[] = [];
	for (const e of input) {
		if (
			e &&
			typeof e === "object" &&
			typeof (e as RegexEntity).placeholder === "string" &&
			typeof (e as RegexEntity).original === "string"
		) {
			out.push(e as RegexEntity);
		}
	}
	return out;
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
	return err instanceof Error ? err.message : String(err);
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
