/**
 * HTTP client for the Brikko Anonymizer sidecar.
 *
 * Adapted from `brikko-studio/packages/privacy-plugin/src/anonymizer-client.ts`
 * with three differences for the n8n use case:
 *
 *   1. Smaller surface area — only the four endpoints the four nodes use
 *      (`/anonymize`, `/restore`, `/health` for probing, no streaming).
 *   2. Pure Node 20+ `fetch` (undici-backed) plus `AbortSignal.timeout()`,
 *      no zod, no DOM types — n8n custom nodes ship to a Node runtime.
 *   3. Errors are deliberately kept plain so the calling node can wrap
 *      them in `NodeOperationError` with `itemIndex` for clean reporting.
 *
 * Concurrency: the client is stateless (no in-memory caches, no circuit
 * breaker). n8n already runs each item independently and surfaces
 * failures per-item via `continueOnFail` — we don't need a second
 * resilience layer here.
 */

import {
	BrikkoRequestError,
	BrikkoUnavailableError,
} from "./errors";
import type {
	AnonymizeRequest,
	AnonymizeResponse,
	RestoreRequest,
	RestoreResponse,
} from "./types";

export interface AnonymizerClientOptions {
	baseUrl: string;
	requestTimeoutMs?: number;
	maxRetries?: number;
	retryBaseDelayMs?: number;
	/** Optional Authorization header value (used in Gateway mode). */
	authorization?: string;
}

const DEFAULTS = {
	requestTimeoutMs: 10_000,
	maxRetries: 3,
	retryBaseDelayMs: 200,
};

export class AnonymizerClient {
	private readonly baseUrl: string;
	private readonly timeoutMs: number;
	private readonly maxRetries: number;
	private readonly retryBaseDelayMs: number;
	private readonly authorization?: string;

	constructor(opts: AnonymizerClientOptions) {
		// Trim trailing slash so concatenation is unambiguous.
		this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
		this.timeoutMs = opts.requestTimeoutMs ?? DEFAULTS.requestTimeoutMs;
		this.maxRetries = opts.maxRetries ?? DEFAULTS.maxRetries;
		this.retryBaseDelayMs =
			opts.retryBaseDelayMs ?? DEFAULTS.retryBaseDelayMs;
		this.authorization = opts.authorization;
	}

	// -- public methods ---------------------------------------------------

	async anonymize(req: AnonymizeRequest): Promise<AnonymizeResponse> {
		return this.postJson<AnonymizeResponse>("/anonymize", req);
	}

	async restore(req: RestoreRequest): Promise<RestoreResponse> {
		return this.postJson<RestoreResponse>("/restore", req);
	}

	/**
	 * Cheap reachability probe used by the `auto` mode resolver.
	 * Returns true on any 2xx response — the Studio /health endpoint
	 * returns 200 with a tiny JSON body, so a single short-deadline GET
	 * is sufficient.
	 */
	async health(): Promise<boolean> {
		const url = this.baseUrl + "/health";
		try {
			const res = await fetch(url, {
				method: "GET",
				signal: AbortSignal.timeout(
					Math.min(this.timeoutMs, 2_000),
				),
			});
			return res.ok;
		} catch {
			return false;
		}
	}

	// -- transport --------------------------------------------------------

	private async postJson<T>(path: string, body: unknown): Promise<T> {
		const url = this.baseUrl + path;
		return this.withRetry(async () => {
			const res = await this.fetchWithTimeout(url, {
				method: "POST",
				headers: this.headers({ "content-type": "application/json" }),
				body: JSON.stringify(body),
			});
			const text = await res.text();
			if (res.status >= 400) {
				throw new BrikkoRequestError(res.status, text);
			}
			return JSON.parse(text) as T;
		});
	}

	private headers(extra: Record<string, string> = {}): Record<string, string> {
		const h: Record<string, string> = {
			accept: "application/json",
			...extra,
		};
		if (this.authorization) h["authorization"] = this.authorization;
		return h;
	}

	private async fetchWithTimeout(
		url: string,
		init: RequestInit,
	): Promise<Response> {
		try {
			return await fetch(url, {
				...init,
				signal: AbortSignal.timeout(this.timeoutMs),
			});
		} catch (err: unknown) {
			throw new BrikkoUnavailableError(url, err);
		}
	}

	private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
		let lastErr: unknown;
		for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
			try {
				return await fn();
			} catch (err: unknown) {
				lastErr = err;
				const transient =
					err instanceof BrikkoUnavailableError ||
					(err instanceof BrikkoRequestError && err.status >= 500);
				if (!transient || attempt === this.maxRetries) throw err;
				const delay = this.retryBaseDelayMs * 2 ** (attempt - 1);
				await sleep(delay);
			}
		}
		// Unreachable — loop either returns or throws.
		throw lastErr instanceof Error ? lastErr : new Error("retry exhausted");
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
