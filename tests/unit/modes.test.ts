import { afterEach, describe, expect, it, vi } from "vitest";

import { BrikkoConfigError } from "../../lib/errors";
import { resolveBackend } from "../../lib/modes";

describe("resolveBackend", () => {
	const origFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = origFetch;
	});

	it("regex mode short-circuits to regex with no creds needed", async () => {
		const r = await resolveBackend({ mode: "regex" });
		expect(r.kind).toBe("regex");
	});

	it("local mode without local creds raises BrikkoConfigError", async () => {
		await expect(resolveBackend({ mode: "local" })).rejects.toBeInstanceOf(
			BrikkoConfigError,
		);
	});

	it("gateway mode without api creds raises BrikkoConfigError", async () => {
		await expect(
			resolveBackend({ mode: "gateway" }),
		).rejects.toBeInstanceOf(BrikkoConfigError);
	});

	it("auto mode with healthy local picks studio", async () => {
		globalThis.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
		const r = await resolveBackend({
			mode: "auto",
			local: { url: "http://localhost:8403", workspaceId: "default" },
		});
		expect(r.kind).toBe("studio");
	});

	it("auto mode with unhealthy local + api creds picks gateway", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		});
		const r = await resolveBackend({
			mode: "auto",
			local: { url: "http://localhost:8403", workspaceId: "ws" },
			api: { apiKey: "k", baseUrl: "https://api.brikko.ru" },
		});
		expect(r.kind).toBe("gateway");
	});

	it("auto mode with no working backend falls back to regex", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("nope");
		});
		const r = await resolveBackend({
			mode: "auto",
			local: { url: "http://localhost:8403", workspaceId: "ws" },
		});
		expect(r.kind).toBe("regex");
	});
});
