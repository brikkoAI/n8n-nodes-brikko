/**
 * Mode resolution: which backend (local Studio sidecar, hosted Brikko
 * Gateway, or pure regex) handles a given node execution.
 *
 * The user picks one of:
 *   - "auto"     — try Studio at localhost:8403; if /health responds, use
 *                  Studio. Otherwise fall through to Gateway if a Brikko
 *                  API credential is configured, else regex (with a
 *                  warning surfaced to the n8n UI via the warning channel).
 *   - "local"    — only Studio. Fail with BrikkoConfigError if unreachable.
 *   - "gateway"  — only the hosted Gateway. Fail with BrikkoConfigError
 *                  if no API credential.
 *   - "regex"    — never call out; do everything locally. Lowest fidelity.
 *
 * The resolver returns a tagged union the calling node consumes. Keeping
 * this in one place (rather than scattered through each node's
 * `execute()`) means we can change mode semantics in exactly one spot.
 */

import { AnonymizerClient } from "./anonymizer-client";
import { BrikkoConfigError } from "./errors";

export type RuntimeMode = "auto" | "local" | "gateway" | "regex";

export interface BrikkoLocalCreds {
	url: string;
	workspaceId: string;
}

export interface BrikkoApiCreds {
	apiKey: string;
	baseUrl: string;
}

export type ResolvedBackend =
	| { kind: "studio"; client: AnonymizerClient; workspaceId: string }
	| { kind: "gateway"; client: AnonymizerClient; workspaceId: string }
	| { kind: "regex" };

export interface ResolveOptions {
	mode: RuntimeMode;
	local?: BrikkoLocalCreds;
	api?: BrikkoApiCreds;
	/** Workspace ID set on the node UI; falls back to creds, then "default". */
	workspaceId?: string;
}

/**
 * Pick a backend for the current invocation.
 *
 * Note: only the "auto" branch performs an active probe (a single 2-second
 * GET). "local" and "gateway" trust the credentials and let the first real
 * call surface any failure as a `BrikkoUnavailableError`. This keeps
 * latency predictable when the user explicitly pinned a mode.
 */
export async function resolveBackend(
	opts: ResolveOptions,
): Promise<ResolvedBackend> {
	const ws =
		opts.workspaceId || opts.local?.workspaceId || "default";

	switch (opts.mode) {
		case "regex":
			return { kind: "regex" };

		case "local": {
			if (!opts.local) {
				throw new BrikkoConfigError(
					'Mode "local" requires Brikko Local Studio credentials.',
				);
			}
			return {
				kind: "studio",
				client: new AnonymizerClient({ baseUrl: opts.local.url }),
				workspaceId: ws,
			};
		}

		case "gateway": {
			if (!opts.api) {
				throw new BrikkoConfigError(
					'Mode "gateway" requires Brikko API credentials.',
				);
			}
			return {
				kind: "gateway",
				client: new AnonymizerClient({
					baseUrl: opts.api.baseUrl,
					authorization: `Bearer ${opts.api.apiKey}`,
				}),
				workspaceId: ws,
			};
		}

		case "auto": {
			if (opts.local) {
				const probe = new AnonymizerClient({
					baseUrl: opts.local.url,
					requestTimeoutMs: 2_000,
				});
				const ok = await probe.health();
				if (ok) {
					return {
						kind: "studio",
						client: probe,
						workspaceId: ws,
					};
				}
			}
			if (opts.api) {
				return {
					kind: "gateway",
					client: new AnonymizerClient({
						baseUrl: opts.api.baseUrl,
						authorization: `Bearer ${opts.api.apiKey}`,
					}),
					workspaceId: ws,
				};
			}
			return { kind: "regex" };
		}
	}
}
