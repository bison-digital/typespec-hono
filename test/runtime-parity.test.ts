import { describe, expect, it } from "vitest";
import { armFor as ours, type ResponseArm } from "../src/runtime.js";
import { armFor as theirs } from "typespec-http-zod/runtime";

/**
 * **This package declares `ResponseArm` and `armFor` rather than re-exporting the library's.**
 *
 * It has to. The emitted runtime is copied beside the generated code so that nothing the emitter
 * writes imports a package at run time, and a re-export would put `typespec-http-zod` back into the
 * consumer's production dependencies, which is the whole thing being removed.
 *
 * The cost of declaring is drift: two implementations of one rule, in two repositories, that nothing
 * compares. This is what compares them. If the library changes how an arm is chosen and this does
 * not, the two artefacts generated from one document start disagreeing about which status a result
 * is checked against, and no other test in either repository would see it.
 */

const arms = [
	{ status: 200, schema: undefined },
	{ status: 404, schema: undefined },
	{ status: "4XX", schema: undefined },
	{ status: "5XX", schema: undefined },
	{ status: "default", schema: undefined },
] as const satisfies readonly ResponseArm[];

describe("the emitted `armFor` answers identically to the library's", () => {
	it.each([
		[200, "an exact match"],
		[404, "an exact match preferred over its range"],
		[418, "no exact code, so the 4XX range"],
		[503, "no exact code, so the 5XX range"],
		[301, "no exact code and no range, so `default`"],
	])("status %i (%s)", (status) => {
		expect(ours(arms, status)).toEqual(theirs(arms, status));
	});

	it("agrees when nothing matches at all", () => {
		const narrow = [{ status: 200, schema: undefined }] as const satisfies readonly ResponseArm[];
		expect(ours(narrow, 404)).toBeUndefined();
		expect(ours(narrow, 404)).toEqual(theirs(narrow, 404));
	});

	it("agrees on an empty arm list", () => {
		expect(ours([], 200)).toEqual(theirs([], 200));
	});

	/**
	 * Non-vacuity. Every arm above asserts the two agree, and two functions that both returned
	 * `undefined` for everything would satisfy all of them.
	 */
	it("is answering with real arms, not agreeing on nothing", () => {
		expect(ours(arms, 200)).toEqual({ status: 200, schema: undefined });
		expect(ours(arms, 418)).toEqual({ status: "4XX", schema: undefined });
		expect(ours(arms, 301)).toEqual({ status: "default", schema: undefined });
	});
});
