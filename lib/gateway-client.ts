/**
 * OpenAI-compatible chat completion client for the Brikko Gateway.
 *
 * `BrikkoChat` uses this to call `/v1/chat/completions` after the prompt
 * has been masked. We deliberately keep the surface area to a single
 * non-streaming method — n8n nodes are item-batch oriented, and SSE
 * streaming would only complicate things for negligible UX gain inside
 * a workflow run.
 */

import {
	BrikkoRequestError,
	BrikkoUnavailableError,
} from "./errors";
import type {
	ChatCompletionRequest,
	ChatCompletionResponse,
} from "./types";

export interface GatewayClientOptions {
	baseUrl: string;
	apiKey: string;
	requestTimeoutMs?: number;
}

export class GatewayClient {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly timeoutMs: number;

	constructor(opts: GatewayClientOptions) {
		this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
		this.apiKey = opts.apiKey;
		this.timeoutMs = opts.requestTimeoutMs ?? 60_000;
	}

	async chatCompletion(
		req: ChatCompletionRequest,
	): Promise<ChatCompletionResponse> {
		const url = this.baseUrl + "/v1/chat/completions";
		let res: Response;
		try {
			res = await fetch(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json",
					authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({ ...req, stream: false }),
				signal: AbortSignal.timeout(this.timeoutMs),
			});
		} catch (err: unknown) {
			throw new BrikkoUnavailableError(url, err);
		}
		const text = await res.text();
		if (res.status >= 400) {
			throw new BrikkoRequestError(res.status, text);
		}
		return JSON.parse(text) as ChatCompletionResponse;
	}
}
