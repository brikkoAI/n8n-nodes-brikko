/**
 * Generate a request_id for the Anonymizer call.
 *
 * The Anonymizer uses request_id as the audit-log correlation key AND as
 * the stable identifier the n8n workflow passes to the Restore node as
 * `mapping_id`. Two requirements:
 *
 *   1. Globally unique within a workspace (collisions break restoration).
 *   2. Roundtrip-safe through n8n's JSON expression engine (no special
 *      characters, no leading digits — UUID v4 satisfies both).
 *
 * Node 20+ exposes `globalThis.crypto.randomUUID()`. Fall back to a
 * minimal Math.random implementation only if running under an exotic
 * runtime (CI containers etc.) — collisions there are still vanishingly
 * unlikely for the workflow-scope sizes n8n deals with.
 */

export function newRequestId(): string {
	const c =
		typeof globalThis !== "undefined"
			? (globalThis as { crypto?: Crypto }).crypto
			: undefined;
	if (c && typeof c.randomUUID === "function") {
		return c.randomUUID();
	}
	// Fallback: RFC4122-ish v4 from Math.random.
	const hex = "0123456789abcdef";
	let s = "";
	for (let i = 0; i < 36; i++) {
		if (i === 8 || i === 13 || i === 18 || i === 23) s += "-";
		else if (i === 14) s += "4";
		else if (i === 19) s += hex[8 + Math.floor(Math.random() * 4)];
		else s += hex[Math.floor(Math.random() * 16)];
	}
	return s;
}
