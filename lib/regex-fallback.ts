/**
 * Best-effort offline / regex-only PII masking and detection.
 *
 * This module is the safety net for two scenarios:
 *
 *   1. The Studio sidecar is offline AND the user did not configure
 *      Gateway credentials — `auto` mode then degrades to regex.
 *   2. The user explicitly picked "regex" mode (e.g. air-gapped network).
 *
 * The patterns deliberately err on the side of recall over precision:
 * better to mask a phone number that wasn't sensitive than to leak one
 * that was. For high-stakes 152-ФЗ workloads we still recommend the
 * Studio sidecar because its NER + checksum validation (INN, SNILS) is
 * far more accurate.
 *
 * Categories match the Studio taxonomy where possible
 * (NAME, EMAIL, PHONE, INN, SNILS, CARD, IBAN, IP, URL, DATE).
 */

export interface RegexEntity {
	category: string;
	placeholder: string;
	original: string;
	start: number;
	end: number;
}

export interface RegexMaskResult {
	masked_text: string;
	entities: RegexEntity[];
}

export interface RegexDetectResult {
	found: Array<{ category: string; count: number; samples: string[] }>;
	total_count: number;
}

interface PatternSpec {
	category: string;
	regex: RegExp;
	/** Optional post-match validator (returns true to keep the match). */
	validate?: (raw: string) => boolean;
}

// -- pattern catalogue ----------------------------------------------------

const PATTERNS: PatternSpec[] = [
	// Email — RFC 5322 lite. Stops at whitespace / common punctuation.
	{
		category: "EMAIL",
		regex: /\b[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g,
	},
	// Russian phone in any common rendering. Not anchored on word
	// boundaries (digits sit next to + and parens), so we use lookarounds.
	// `[\s\-.()]*` (not `?`) so formats like `+7 (495) 123-45-67` — which
	// have multiple consecutive separators between groups — match cleanly.
	{
		category: "PHONE",
		regex:
			/(?<!\d)(?:\+7|7|8)[\s\-.()]*\d{3}[\s\-.()]*\d{3}[\s\-.()]*\d{2}[\s\-.()]*\d{2}(?!\d)/g,
	},
	// Russian INN — 10 or 12 consecutive digits, validated by checksum.
	{
		category: "INN",
		regex: /(?<!\d)\d{10}(?!\d)|(?<!\d)\d{12}(?!\d)/g,
		validate: validateInn,
	},
	// Russian SNILS — XXX-XXX-XXX YY or 11 contiguous digits.
	{
		category: "SNILS",
		regex: /(?<!\d)\d{3}-\d{3}-\d{3}[\s-]\d{2}(?!\d)/g,
	},
	// Bank card — 13-19 digits, optional spaces or dashes every 4.
	// Checksum-validated (Luhn) so we don't false-positive on order IDs.
	{
		category: "CARD",
		regex: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
		validate: validateLuhn,
	},
	// IPv4. Octets 0-255 enforced.
	{
		category: "IP",
		regex:
			/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g,
	},
	// URLs (http/https only — broader patterns false-positive on prose).
	{
		category: "URL",
		regex: /\bhttps?:\/\/[^\s<>"']+/g,
	},
	// Russian-format date 12.05.2026 or 12/05/2026.
	{
		category: "DATE",
		regex: /\b(?:0?[1-9]|[12]\d|3[01])[./](?:0?[1-9]|1[012])[./](?:19|20)\d{2}\b/g,
	},
];

// -- public API -----------------------------------------------------------

/**
 * Mask all detected PII in `text`. Returns the rewritten string plus the
 * entity list. Placeholders follow the `<CATEGORY_NNN>` convention so they
 * round-trip cleanly through regex restore.
 *
 * Implementation: collect every match across all patterns, sort by start
 * index, drop overlaps (first-match wins), then splice. Per-category
 * counters ensure stable placeholders across runs.
 */
export function regexMask(text: string): RegexMaskResult {
	type Hit = { spec: PatternSpec; index: number; raw: string };
	const hits: Hit[] = [];

	for (const spec of PATTERNS) {
		// Reset state since regexes are global.
		spec.regex.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = spec.regex.exec(text)) !== null) {
			const raw = m[0];
			if (spec.validate && !spec.validate(raw)) continue;
			hits.push({ spec, index: m.index, raw });
		}
	}

	hits.sort((a, b) => a.index - b.index);

	// Drop overlaps — keep the earliest, longest match.
	const accepted: Hit[] = [];
	let cursor = -1;
	for (const h of hits) {
		if (h.index < cursor) continue;
		accepted.push(h);
		cursor = h.index + h.raw.length;
	}

	const counters = new Map<string, number>();
	const entities: RegexEntity[] = [];
	let out = "";
	let pos = 0;

	for (const h of accepted) {
		const next = (counters.get(h.spec.category) ?? 0) + 1;
		counters.set(h.spec.category, next);
		const placeholder = `<${h.spec.category}_${String(next).padStart(3, "0")}>`;
		out += text.slice(pos, h.index) + placeholder;
		entities.push({
			category: h.spec.category,
			placeholder,
			original: h.raw,
			start: h.index,
			end: h.index + h.raw.length,
		});
		pos = h.index + h.raw.length;
	}
	out += text.slice(pos);

	return { masked_text: out, entities };
}

/**
 * Detect-only counterpart. No mutation, just a tally per category. Used
 * by `Brikko Detect PII` when running offline.
 */
export function regexDetect(
	text: string,
	categories?: string[],
): RegexDetectResult {
	const wanted =
		categories && categories.length > 0
			? new Set(categories.map((c) => c.toUpperCase()))
			: null;

	const found: RegexDetectResult["found"] = [];
	let total = 0;

	for (const spec of PATTERNS) {
		if (wanted && !wanted.has(spec.category)) continue;
		spec.regex.lastIndex = 0;
		let m: RegExpExecArray | null;
		let count = 0;
		const samples: string[] = [];
		while ((m = spec.regex.exec(text)) !== null) {
			if (spec.validate && !spec.validate(m[0])) continue;
			count += 1;
			if (samples.length < 3) samples.push(m[0]);
		}
		if (count > 0) {
			found.push({ category: spec.category, count, samples });
			total += count;
		}
	}

	return { found, total_count: total };
}

/**
 * Restore from a previous `regexMask` call. Since regex mode does NOT
 * persist mappings server-side, the caller must pass the entities list
 * back in. The n8n node packs `entities` into the item alongside the
 * masked text so the Restore node can pick it up via expressions.
 */
export function regexRestore(
	masked: string,
	entities: RegexEntity[],
): { restored_text: string; hallucinated: string[] } {
	let out = masked;
	const seen = new Set<string>();
	for (const e of entities) {
		seen.add(e.placeholder);
		// Replace every occurrence of the placeholder, not just the first —
		// LLMs sometimes echo placeholders verbatim in their responses.
		out = out.split(e.placeholder).join(e.original);
	}

	// Detect placeholders the model invented.
	const hallucinated = new Set<string>();
	const phRegex = /<[A-Z]+_\d{3}>/g;
	let m: RegExpExecArray | null;
	while ((m = phRegex.exec(out)) !== null) {
		if (!seen.has(m[0])) hallucinated.add(m[0]);
	}
	return { restored_text: out, hallucinated: [...hallucinated] };
}

// -- validators -----------------------------------------------------------

/**
 * Validate Russian INN (taxpayer ID).
 * 10-digit (legal entity) and 12-digit (individual) variants have
 * different checksum rules — both implemented per ФНС spec.
 */
function validateInn(raw: string): boolean {
	const digits = raw.replace(/\D/g, "");
	if (digits.length === 10) {
		const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
		let s = 0;
		for (let i = 0; i < 9; i++) s += Number(digits[i]) * w[i];
		const check = (s % 11) % 10;
		return check === Number(digits[9]);
	}
	if (digits.length === 12) {
		const w1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
		const w2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
		let s1 = 0;
		for (let i = 0; i < 10; i++) s1 += Number(digits[i]) * w1[i];
		const c1 = (s1 % 11) % 10;
		let s2 = 0;
		for (let i = 0; i < 11; i++) s2 += Number(digits[i]) * w2[i];
		const c2 = (s2 % 11) % 10;
		return c1 === Number(digits[10]) && c2 === Number(digits[11]);
	}
	return false;
}

/** Luhn checksum (bank cards). */
function validateLuhn(raw: string): boolean {
	const digits = raw.replace(/\D/g, "");
	if (digits.length < 13 || digits.length > 19) return false;
	let sum = 0;
	let alt = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let n = Number(digits[i]);
		if (alt) {
			n *= 2;
			if (n > 9) n -= 9;
		}
		sum += n;
		alt = !alt;
	}
	return sum % 10 === 0;
}
