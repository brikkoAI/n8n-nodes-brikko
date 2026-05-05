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
import { regexDetect } from "../../lib/regex-fallback";
import { newRequestId } from "../../lib/request-id";
import type { BrikkoDetectOutput } from "../../lib/types";

/**
 * Detect-only node: returns the categories of PII present in a string
 * but does NOT rewrite it. Common usecases: bulk audit on a CSV upload,
 * gating a workflow ("if INN found → human review"), compliance logging.
 *
 * Internally we use the `/anonymize` endpoint when Studio or Gateway is
 * available — it produces both the masked text and the entity list — and
 * just discard the masked text. This guarantees parity with what
 * Anonymize would have done. In regex mode, `regexDetect` does it
 * directly without producing placeholders.
 */
export class BrikkoDetectPii implements INodeType {
	description: INodeTypeDescription = {
		displayName: "Brikko Detect PII",
		name: "brikkoDetectPii",
		icon: "file:brikko.svg",
		group: ["transform"],
		version: 1,
		description:
			"Scan text for personal data without modifying it. Returns " +
			"categories, counts, and sample values.",
		defaults: { name: "Brikko Detect PII" },
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
				description: "Text to scan. Текст для проверки.",
			},
			{
				displayName: "Categories / Категории",
				name: "categories",
				type: "multiOptions",
				default: [],
				description:
					"Limit detection to these categories. Empty = all. " +
					"Пустой список = все категории.",
				options: [
					{ name: "Bank Card / Карта", value: "CARD" },
					{ name: "Date / Дата", value: "DATE" },
					{ name: "Email", value: "EMAIL" },
					{ name: "IBAN", value: "IBAN" },
					{ name: "INN / ИНН", value: "INN" },
					{ name: "IP Address", value: "IP" },
					{ name: "Person Name / ФИО", value: "NAME" },
					{ name: "Phone / Телефон", value: "PHONE" },
					{ name: "SNILS / СНИЛС", value: "SNILS" },
					{ name: "URL", value: "URL" },
				],
			},
			{
				displayName: "Include Samples / Примеры",
				name: "includeSamples",
				type: "boolean",
				default: true,
				description:
					"Whether to include up to 3 sample values per category. " +
					"Disable for compliance pipelines that must not propagate " +
					"raw PII even into logs. " +
					"Включать примеры значений (отключите для compliance).",
			},
			WORKSPACE_PROPERTY,
			{
				displayName: "Output Field / Поле результата",
				name: "outputField",
				type: "string",
				default: "brikko_pii",
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
				const categories = this.getNodeParameter(
					"categories",
					i,
				) as string[];
				const includeSamples = this.getNodeParameter(
					"includeSamples",
					i,
				) as boolean;
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

				let result: BrikkoDetectOutput;

				if (backend.kind === "regex") {
					const det = regexDetect(text, categories);
					result = {
						found_pii: det.found.map((f) => ({
							category: f.category,
							count: f.count,
							samples: includeSamples ? f.samples : [],
						})),
						total_count: det.total_count,
						source: "regex",
					};
				} else {
					// Use /anonymize to leverage the same NER pipeline, then
					// discard the masked text and aggregate entities.
					const resp = await backend.client.anonymize({
						workspace_id: backend.workspaceId,
						text,
						policy_profile: "balanced",
						session_id: "n8n-detect",
						request_id: newRequestId(),
					});
					const counters = new Map<string, number>();
					const samples = new Map<string, string[]>();
					for (const e of resp.entities) {
						if (
							categories.length > 0 &&
							!categories.includes(e.category)
						)
							continue;
						counters.set(
							e.category,
							(counters.get(e.category) ?? 0) + 1,
						);
						if (includeSamples) {
							const arr = samples.get(e.category) ?? [];
							if (arr.length < 3) arr.push(e.placeholder);
							samples.set(e.category, arr);
						}
					}
					const found: BrikkoDetectOutput["found_pii"] = [];
					let total = 0;
					for (const [category, count] of counters.entries()) {
						total += count;
						found.push({
							category,
							count,
							samples: samples.get(category) ?? [],
						});
					}
					result = {
						found_pii: found,
						total_count: total,
						source: "studio",
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
