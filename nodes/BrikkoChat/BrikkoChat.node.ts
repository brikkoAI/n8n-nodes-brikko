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
import { GatewayClient } from "../../lib/gateway-client";
import { resolveBackend, type RuntimeMode } from "../../lib/modes";
import {
	MODE_PROPERTY,
	POLICY_PROPERTY,
	WORKSPACE_PROPERTY,
} from "../../lib/node-shared";
import {
	regexMask,
	regexRestore,
} from "../../lib/regex-fallback";
import { newRequestId } from "../../lib/request-id";
import type {
	BrikkoChatOutput,
	PolicyProfileName,
} from "../../lib/types";

/**
 * BrikkoChat: anonymize → call Brikko Gateway → restore. Single node so
 * casual users don't have to wire three nodes for the common "send a
 * message to an LLM" case.
 *
 * Implementation note: we always invoke the privacy step on the input
 * AND on the LLM response. The latter catches cases where the model
 * echoed the placeholders verbatim, or hallucinated similar-looking
 * tokens — restoring those silently means the workflow downstream sees
 * the real customer name, not `<NAME_001>`.
 */
export class BrikkoChat implements INodeType {
	description: INodeTypeDescription = {
		displayName: "Brikko Chat",
		name: "brikkoChat",
		icon: "file:brikko.svg",
		group: ["transform"],
		version: 1,
		subtitle: '={{ $parameter["model"] }}',
		description:
			"Anonymize prompt → call Brikko Gateway LLM → restore PII in " +
			"response. One-node privacy-aware chat.",
		defaults: { name: "Brikko Chat" },
		inputs: ["main"],
		outputs: ["main"],
		credentials: [
			{ name: "brikkoApi", required: true },
			{ name: "brikkoLocalApi", required: false },
		],
		properties: [
			MODE_PROPERTY,
			{
				displayName: "Prompt / Запрос",
				name: "prompt",
				type: "string",
				typeOptions: { rows: 4 },
				default: "={{ $json.prompt }}",
				required: true,
				description: "User prompt sent to the model. Запрос пользователя.",
			},
			{
				displayName: "System Prompt / Системный запрос",
				name: "system",
				type: "string",
				typeOptions: { rows: 2 },
				default: "",
				description:
					"Optional system message. Sent verbatim — NOT anonymized. " +
					"Системное сообщение (не маскируется).",
			},
			{
				displayName: "Model / Модель",
				name: "model",
				type: "options",
				default: "claude-sonnet-4-6",
				description:
					"Brikko Gateway model ID. Free-form override available below. " +
					"ID модели в шлюзе Brikko.",
				options: [
					{ name: "Claude Haiku 4.5", value: "claude-haiku-4-5" },
					{ name: "Claude Opus 4.7", value: "claude-opus-4-7" },
					{ name: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
					{ name: "Custom (See Field Below) / Своя", value: "__custom__" },
					{ name: "DeepSeek V3.2 Chat", value: "deepseek-v3.2-chat" },
					{ name: "Gemini 3 Flash", value: "gemini-3-flash" },
					{ name: "Gemini 3.1 Pro", value: "gemini-3.1-pro" },
					{ name: "GigaChat 2 Lite", value: "gigachat-2-lite" },
					{ name: "GigaChat 2 Pro", value: "gigachat-2-pro" },
					{ name: "GPT-5", value: "gpt-5" },
					{ name: "GPT-5.4", value: "gpt-5.4" },
					{ name: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
					{ name: "YandexGPT 5 Lite", value: "yandexgpt-5-lite" },
					{ name: "YandexGPT 5.1 Pro", value: "yandexgpt-5.1-pro" },
				],
			},
			{
				displayName: "Custom Model ID / Своя модель",
				name: "customModel",
				type: "string",
				default: "",
				displayOptions: { show: { model: ["__custom__"] } },
				description:
					"Free-form model ID. Use when Brikko adds a model the " +
					"dropdown doesn't yet list. Свободный ввод ID модели.",
			},
			{
				displayName: "Temperature",
				name: "temperature",
				type: "number",
				typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
				default: 0.7,
			},
			{
				displayName: "Max Tokens / Лимит токенов",
				name: "maxTokens",
				type: "number",
				typeOptions: { minValue: 1, maxValue: 32_000 },
				default: 1024,
			},
			POLICY_PROPERTY,
			WORKSPACE_PROPERTY,
			{
				displayName: "Output Field / Поле результата",
				name: "outputField",
				type: "string",
				default: "brikko_chat",
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		// brikkoApi is required at the descriptor level — getCredentials
		// will throw a clear error in the UI if the user hasn't picked one.
		const api = (await this.getCredentials("brikkoApi")) as
			| { apiKey: string; baseUrl: string }
			| undefined;
		if (!api) {
			throw new NodeOperationError(
				this.getNode(),
				"Brikko Chat requires a Brikko API credential.",
			);
		}
		const local = await safeCred(this, "brikkoLocalApi");

		const gateway = new GatewayClient({
			baseUrl: api.baseUrl,
			apiKey: api.apiKey,
		});

		for (let i = 0; i < items.length; i++) {
			const t0 = Date.now();
			try {
				const mode = this.getNodeParameter("mode", i) as RuntimeMode;
				const prompt = this.getNodeParameter("prompt", i) as string;
				const system = this.getNodeParameter("system", i) as string;
				const modelSel = this.getNodeParameter("model", i) as string;
				const customModel = this.getNodeParameter(
					"customModel",
					i,
					"",
				) as string;
				const temperature = this.getNodeParameter(
					"temperature",
					i,
				) as number;
				const maxTokens = this.getNodeParameter(
					"maxTokens",
					i,
				) as number;
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
				const model =
					modelSel === "__custom__" ? customModel.trim() : modelSel;

				if (!model) {
					throw new NodeOperationError(
						this.getNode(),
						"Model is empty — pick one or fill Custom Model ID.",
						{ itemIndex: i },
					);
				}
				if (typeof prompt !== "string" || prompt.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						"Prompt is empty.",
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
					api: { apiKey: api.apiKey, baseUrl: api.baseUrl },
					workspaceId: wsOverride,
				});

				const requestId = newRequestId();
				let maskedPrompt: string;
				let regexEntities: ReturnType<typeof regexMask>["entities"] = [];

				// 1. anonymize the prompt
				if (backend.kind === "regex") {
					const r = regexMask(prompt);
					maskedPrompt = r.masked_text;
					regexEntities = r.entities;
				} else {
					const a = await backend.client.anonymize({
						workspace_id: backend.workspaceId,
						text: prompt,
						policy_profile: policy,
						session_id: "n8n",
						request_id: requestId,
					});
					maskedPrompt = a.masked_text;
				}

				// 2. call the Gateway with the masked prompt
				const messages = [];
				if (system) messages.push({ role: "system" as const, content: system });
				messages.push({ role: "user" as const, content: maskedPrompt });

				const completion = await gateway.chatCompletion({
					model,
					messages,
					temperature,
					max_tokens: maxTokens,
				});
				const maskedResponse =
					completion.choices?.[0]?.message?.content ?? "";

				// 3. restore PII in the response
				let restored: string;
				if (backend.kind === "regex") {
					restored = regexRestore(maskedResponse, regexEntities)
						.restored_text;
				} else {
					const r = await backend.client.restore({
						workspace_id: backend.workspaceId,
						text: maskedResponse,
						request_id: requestId,
					});
					restored = r.restored_text;
				}

				const result: BrikkoChatOutput = {
					response: restored,
					masked_prompt: maskedPrompt,
					masked_response: maskedResponse,
					mapping_id: requestId,
					model,
					latency_ms: Date.now() - t0,
					source: backend.kind === "studio" ? "studio" : "gateway",
				};

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
