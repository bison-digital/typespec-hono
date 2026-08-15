import { describe, expect, it } from "vitest";
import { selectContentType } from "../src/runtime.js";

/**
 * **`selectContentType` had no behavioural test until this file, and it was wrong in three ways.**
 *
 * `compiles.test.ts` asserted that the string `selectContentType(` appears in emitted output, which
 * is a claim that negotiation is WIRED, not that it is CORRECT. The function shipped in the runtime
 * every consumer imports, so the defects below were live: most seriously, a caller writing
 * `Accept: *​/*, application/json;q=0` - an explicit refusal of JSON - was served JSON.
 *
 * **The cause was one rule read as a tie-break instead of a selector.** RFC 9110 section 12.5.1 says
 * the MOST SPECIFIC matching range determines a type's quality; the implementation instead scored
 * every matching range and kept the best `(q, specificity)` pair, so a permissive wildcard could
 * out-vote the precise rule written about that exact type. The docblock stated the correct rules the
 * whole time - "`q=0` is a REFUSAL ... a range scoring zero can never be chosen" - which is what
 * makes this worth a suite rather than a patch: the prose was right and nothing compared it to the
 * code.
 */
describe("Accept negotiation follows RFC 9110 section 12.5.1", () => {
	it("takes a type's quality from the most specific range that matches it", () => {
		// application/json's most specific match is its own q=0.1; text/plain's is the wildcard at 1.0.
		expect(
			selectContentType("*/*;q=1.0, application/json;q=0.1", ["application/json", "text/plain"]),
		).toBe("text/plain");
	});

	it("treats q=0 as a refusal even when a wildcard would accept", () => {
		// The dangerous one: serving a media type the caller explicitly refused.
		expect(selectContentType("*/*, application/json;q=0", ["application/json", "text/plain"])).toBe(
			"text/plain",
		);
	});

	it("refuses everything when every offer is scored zero", () => {
		expect(selectContentType("application/json;q=0", ["application/json"])).toBeUndefined();
	});

	it("prefers an exact type over a subtype wildcard when choosing which rule applies", () => {
		// text/plain is pinned to 0.1 by its own rule; text/html takes 0.9 from `text/*`.
		expect(selectContentType("text/*;q=0.9, text/plain;q=0.1", ["text/plain", "text/html"])).toBe(
			"text/html",
		);
	});

	it("keeps the offer order when qualities tie", () => {
		// The document lists media types in an order; nothing in the header displaces it.
		expect(selectContentType("*/*", ["application/json", "text/plain"])).toBe("application/json");
	});

	it("serves the first offer when the caller states no preference", () => {
		for (const accept of [undefined, "", "   "]) {
			expect(selectContentType(accept, ["application/json", "text/plain"])).toBe(
				"application/json",
			);
		}
	});

	it("answers undefined when nothing offered is acceptable, which is the 406", () => {
		expect(selectContentType("application/xml", ["application/json"])).toBeUndefined();
	});

	it("ignores parameters after the media range", () => {
		expect(selectContentType("application/json;charset=utf-8", ["application/json"])).toBe(
			"application/json",
		);
	});

	it("matches case-insensitively, as media types are", () => {
		expect(selectContentType("APPLICATION/JSON", ["application/json"])).toBe("application/json");
	});

	it("offers nothing when the operation offers nothing", () => {
		expect(selectContentType("*/*", [])).toBeUndefined();
	});

	it("ignores a malformed q rather than scoring it zero", () => {
		// `Number("1.2.3")` is NaN. Treating that as a refusal would reject a caller for a typo.
		expect(selectContentType("application/json;q=1.2.3", ["application/json"])).toBe(
			"application/json",
		);
	});
});
