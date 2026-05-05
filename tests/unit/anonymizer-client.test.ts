import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { AnonymizerClient } from "../../lib/anonymizer-client";
import {
	BrikkoRequestError,
	BrikkoUnavailableError,
} from "../../lib/errors";

/**
 * We stub `globalThis.fetch` directly. Lighter than spinning up undici
 * mock-pool and avoids pulling another dev dep just for these tests.
 */

interface StubResponse {
	status: number;
	body: string;
	ok?: boolean;
}

function stubFetchSequence(responses: Array<StubResponse | Error>) {
	let i = 0;
	return vi.fn(async () => {
		const r = responses[Math.min(i++, responses.length - 1)];
		if (r instanceof Error) throw r;
		return new Response(r.body, { status: r.status });
	});
}

describe("AnonymizerClient", () => {
	const origFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = origFetch;
	});

	it("posts /anonymize and parses the response", async () => {
		globalThis.fetch = stubFetchSequence([
			{
				status: 200,
				body: JSON.stringify({
					masked_text: "Hi <NAME_001>",
					entities: [
						{
							placeholder: "<NAME_001>",
							category: "NAME",
							confidence: 0.95,
						},
					],
					request_id: "req-1",
					degraded_mode: false,
					latency_ms: 12,
				}),
			},
		]);

		const c = new AnonymizerClient({
			baseUrl: "http://localhost:8403",
			maxRetries: 1,
		});
		const r = await c.anonymize({
			workspace_id: "ws",
			text: "Hi Ivan",
			request_id: "req-1",
		});
		expect(r.masked_text).toBe("Hi <NAME_001>");
		expect(r.entities[0].category).toBe("NAME");
	});

	it("retries on 5xx and eventually succeeds", async () => {
		globalThis.fetch = stubFetchSequence([
			{ status: 503, body: "down" },
			{ status: 502, body: "bad gateway" },
			{
				status: 200,
				body: JSON.stringify({
					masked_text: "ok",
					entities: [],
					request_id: "r",
					degraded_mode: false,
					latency_ms: 1,
				}),
			},
		]);

		const c = new AnonymizerClient({
			baseUrl: "http://x",
			maxRetries: 3,
			retryBaseDelayMs: 1,
		});
		const r = await c.anonymize({
			workspace_id: "ws",
			text: "x",
			request_id: "r",
		});
		expect(r.masked_text).toBe("ok");
	});

	it("does NOT retry on 4xx and surfaces BrikkoRequestError", async () => {
		const fetchMock = stubFetchSequence([
			{ status: 400, body: '{"error":"bad_request"}' },
		]);
		globalThis.fetch = fetchMock;

		const c = new AnonymizerClient({
			baseUrl: "http://x",
			maxRetries: 3,
			retryBaseDelayMs: 1,
		});
		await expect(
			c.anonymize({ workspace_id: "ws", text: "x", request_id: "r" }),
		).rejects.toBeInstanceOf(BrikkoRequestError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("wraps fetch errors in BrikkoUnavailableError", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new TypeError("ECONNREFUSED");
		});

		const c = new AnonymizerClient({
			baseUrl: "http://nope",
			maxRetries: 1,
		});
		await expect(
			c.anonymize({ workspace_id: "ws", text: "x", request_id: "r" }),
		).rejects.toBeInstanceOf(BrikkoUnavailableError);
	});

	it("attaches Authorization header in Gateway mode", async () => {
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			const auth = (init?.headers as Record<string, string>).authorization;
			expect(auth).toBe("Bearer secret");
			return new Response(
				JSON.stringify({
					masked_text: "x",
					entities: [],
					request_id: "r",
					degraded_mode: false,
					latency_ms: 0,
				}),
				{ status: 200 },
			);
		});
		globalThis.fetch = fetchMock as typeof fetch;

		const c = new AnonymizerClient({
			baseUrl: "https://api.brikko.ru",
			authorization: "Bearer secret",
		});
		await c.anonymize({
			workspace_id: "ws",
			text: "x",
			request_id: "r",
		});
		expect(fetchMock).toHaveBeenCalled();
	});

	it("health() returns true on 200", async () => {
		globalThis.fetch = stubFetchSequence([{ status: 200, body: "ok" }]);
		const c = new AnonymizerClient({ baseUrl: "http://x" });
		expect(await c.health()).toBe(true);
	});

	it("health() returns false on network error", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("nope");
		});
		const c = new AnonymizerClient({ baseUrl: "http://x" });
		expect(await c.health()).toBe(false);
	});
});

describe("modes (smoke)", () => {
	beforeEach(() => {
		// no-op, here to keep the file structure consistent if we add
		// shared setup later.
	});
	it("placeholder", () => {
		expect(true).toBe(true);
	});
});
