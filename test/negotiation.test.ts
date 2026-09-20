import { Hono } from "hono";
import { accepts } from "hono/accepts";
import { describe, expect, it } from "vitest";
import { selectContentType } from "../src/runtime.js";

/**
 * **`selectContentType` had no behavioural test until this file, and it was wrong in three ways.**
 *
 * `compiles.test.ts` asserted that the string `selectContentType(` appears in emitted output, which
 * is a claim that negotiation is WIRED, not that it is CORRECT. The function shipped in the runtime
 * every consumer imports, so the defects below were live: most seriously, a caller writing
 * an `Accept` of any type at all with `application/json;q=0` after it - an explicit refusal of
 * JSON - was served JSON.
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

/** What `hono/accepts` answers, driven through a real request so its `Context` is a real one. */
async function honoAccepts(
	header: string | undefined,
	offered: readonly string[],
): Promise<string | undefined> {
	const app = new Hono();
	let chosen: string | undefined;
	app.get("/", (c) => {
		chosen = accepts(c, {
			header: "Accept",
			supports: [...offered],
			default: offered[0] as string,
		});
		return c.body(null, 204);
	});
	await app.request("/", header === undefined ? {} : { headers: { accept: header } });
	return chosen;
}

/**
 * **Why this is hand-written when Hono ships `hono/accepts`.**
 *
 * The docblock on `selectContentType` explains why negotiation belongs in the runtime rather than in
 * `RouteDeps`, and never said why it is not Hono's own helper - so the decision read as
 * not-invented-here. It is not: `accepts` matches `accept.type` against the supported list by
 * equality, after sorting on `q`. That is three rules short of RFC 9110 section 12.5.1, and each gap
 * is a wrong answer a caller can produce.
 *
 * Measured on hono 4.13.8, on the six cases below, the two differ on four:
 *
 *     case               selectContentType   hono/accepts        agree?
 *     subtype wildcard   text/plain          text/plain          yes
 *     q=0 refusal        text/plain          application/json    NO
 *     406 reachable      undefined           application/json    NO
 *     q=0 only offer     undefined           application/json    NO
 *     negative q         application/json    text/plain          NO
 *     uppercase Q=0      text/plain          application/json    NO
 *
 * Two reasons remain, and one has expired:
 *
 * - `q=0` is a weak preference rather than a refusal, so the exact defect this file was written for
 *   - serving a media type the caller explicitly refused - is Hono's current behaviour;
 * - nothing is unacceptable, so there is no 406: a caller asking for `image/png` from a JSON-only
 *   operation is served JSON;
 * - a subtype wildcard USED to match nothing, so `Accept: text/*` was served JSON. Hono 4.13.4
 *   fixed it (`fix(accepts): support wildcard media types and specificity ordering in defaultMatch`,
 *   honojs/hono#5255) and the arm below records the agreement instead.
 *
 * **One divergence is now ours, not Hono's.** Hono 4.13.8 clamps a negative `q` to 0
 * (`fix(accept): clamp a negative q to 0, not 1`, honojs/hono#5357); `selectContentType` ignores a
 * malformed `q` and falls back to the default of 1, which the arm above deliberately asserts. RFC
 * 9110 defines neither, so this is a choice rather than a defect, but the claim that every
 * difference is Hono's is no longer true.
 *
 * **Kept as arms rather than a comment so the decision can expire.** This is what expiry looks like:
 * the wildcard arm failed the first time the package was run on a hono newer than 4.13.1. If the
 * last two go the same way, delete this implementation and use Hono's.
 */
describe("hono/accepts is not a substitute, and this is the evidence", () => {
	it("agrees wherever the header is a plain ordered preference", async () => {
		for (const header of [
			undefined,
			"application/json",
			"text/plain",
			"*/*",
			"application/json;q=0.5, text/plain;q=0.9",
		]) {
			const offered = ["application/json", "text/plain"];
			expect(await honoAccepts(header, offered), String(header)).toBe(
				selectContentType(header, offered),
			);
		}
	});

	// Expired. Hono 4.13.4 (honojs/hono#5255) made this agree; kept as the record that it does.
	it("agrees on a subtype wildcard, which Hono did not match before 4.13.4", async () => {
		const offered = ["application/json", "text/plain"];
		expect(selectContentType("text/*", offered)).toBe("text/plain");
		expect(await honoAccepts("text/*", offered)).toBe("text/plain");
	});

	// The one difference that is ours: Hono 4.13.8 clamps a negative q to 0, this ignores a malformed
	// q and keeps the default of 1. RFC 9110 defines neither.
	it("differs on a negative q, and here it is Hono that changed", async () => {
		const offered = ["application/json", "text/plain"];
		expect(selectContentType("application/json;q=-1, text/plain;q=0.5", offered)).toBe(
			"application/json",
		);
		expect(await honoAccepts("application/json;q=-1, text/plain;q=0.5", offered)).toBe(
			"text/plain",
		);
	});

	it("differs on q=0, which it does not read as a refusal", async () => {
		const offered = ["application/json", "text/plain"];
		expect(selectContentType("*/*, application/json;q=0", offered)).toBe("text/plain");
		expect(await honoAccepts("*/*, application/json;q=0", offered)).toBe("application/json");
	});

	it("differs on whether 406 is reachable at all", async () => {
		// Nothing offered is acceptable, which is the one case that must not be served.
		expect(selectContentType("image/png", ["application/json"])).toBeUndefined();
		expect(await honoAccepts("image/png", ["application/json"])).toBe("application/json");
	});
});
