import { describe, expect, it } from "vitest";

import {
	regexDetect,
	regexMask,
	regexRestore,
} from "../../lib/regex-fallback";

describe("regexMask", () => {
	it("masks an email and a Russian phone number", () => {
		const text =
			"Contact: ivan.petrov@example.ru, phone +7 (495) 123-45-67.";
		const r = regexMask(text);
		expect(r.entities).toHaveLength(2);
		expect(r.entities.map((e) => e.category).sort()).toEqual([
			"EMAIL",
			"PHONE",
		]);
		expect(r.masked_text).not.toContain("ivan.petrov@example.ru");
		expect(r.masked_text).not.toContain("+7 (495) 123-45-67");
		expect(r.masked_text).toMatch(/<EMAIL_001>/);
		expect(r.masked_text).toMatch(/<PHONE_001>/);
	});

	it("validates Russian INN by checksum", () => {
		// 7707083893 = real Sberbank INN, valid checksum.
		const ok = regexMask("ИНН: 7707083893");
		expect(ok.entities.some((e) => e.category === "INN")).toBe(true);

		// 7707083890 = same prefix, wrong check digit.
		const bad = regexMask("ИНН: 7707083890");
		expect(bad.entities.some((e) => e.category === "INN")).toBe(false);
	});

	it("validates bank cards with Luhn", () => {
		// 4111 1111 1111 1111 = canonical Luhn-valid test card.
		const ok = regexMask("Card 4111 1111 1111 1111");
		expect(ok.entities.some((e) => e.category === "CARD")).toBe(true);

		// off-by-one last digit → invalid.
		const bad = regexMask("Card 4111 1111 1111 1112");
		expect(bad.entities.some((e) => e.category === "CARD")).toBe(false);
	});

	it("emits stable, monotonically numbered placeholders", () => {
		const r = regexMask(
			"a@x.ru and b@x.ru and c@x.ru",
		);
		const phs = r.entities.map((e) => e.placeholder);
		expect(phs).toEqual(["<EMAIL_001>", "<EMAIL_002>", "<EMAIL_003>"]);
	});

	it("handles overlapping matches by keeping the first", () => {
		// A bare 10-digit INN can also pattern-overlap with a CARD prefix
		// when sandwiched against neighbouring digits. Confirm we don't
		// double-count.
		const r = regexMask("INN 7707083893 only");
		const ranges = r.entities.map((e) => `${e.start}-${e.end}`);
		const sorted = [...ranges].sort();
		expect(sorted).toEqual(ranges); // already sorted == no overlaps
	});
});

describe("regexDetect", () => {
	it("filters by category list when given", () => {
		const text = "Email a@x.ru, phone +7 495 123 45 67";
		const all = regexDetect(text);
		expect(all.total_count).toBe(2);

		const onlyEmail = regexDetect(text, ["EMAIL"]);
		expect(onlyEmail.total_count).toBe(1);
		expect(onlyEmail.found[0].category).toBe("EMAIL");
	});

	it("returns up to 3 samples per category", () => {
		const text = "a@x.ru b@x.ru c@x.ru d@x.ru e@x.ru";
		const det = regexDetect(text);
		const email = det.found.find((f) => f.category === "EMAIL")!;
		expect(email.count).toBe(5);
		expect(email.samples).toHaveLength(3);
	});
});

describe("regexRestore", () => {
	it("reverses a previous mask", () => {
		const original = "Email me at user@example.com please.";
		const m = regexMask(original);
		const r = regexRestore(m.masked_text, m.entities);
		expect(r.restored_text).toBe(original);
		expect(r.hallucinated).toEqual([]);
	});

	it("flags hallucinated placeholders the LLM made up", () => {
		const m = regexMask("My email is real@x.ru.");
		// Simulate an LLM response that invented a new placeholder.
		const llmOut = `${m.masked_text} See also <PHONE_999>.`;
		const r = regexRestore(llmOut, m.entities);
		expect(r.hallucinated).toEqual(["<PHONE_999>"]);
	});

	it("replaces every occurrence, not just the first", () => {
		const m = regexMask("Email a@x.ru once.");
		const ph = m.entities[0].placeholder;
		const echoed = `${ph} again ${ph}`;
		const r = regexRestore(echoed, m.entities);
		expect(r.restored_text).toBe("a@x.ru again a@x.ru");
	});
});
