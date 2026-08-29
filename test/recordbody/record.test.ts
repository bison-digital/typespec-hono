import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A `Record` body beside a query parameter emitted a server that does not compile.**
 *
 * Intersected, the body's index signature is imposed on every sibling:
 * `TS2345: 'q' is incompatible with index signature`. And flattening was wrong before it failed to
 * compile - the document states the parameters and the body separately, so merged, a body key named
 * `q` silently overwrites the query parameter of that name.
 *
 * That it COMPILES is asserted by `compiles.test.ts`, which puts every fixture through `tsc`. This
 * asserts the shape, so a future change cannot make it compile by flattening it differently.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let source: string;

beforeAll(async () => {
	const compiled = await compileFixture(here, "record", { outName: "recordbody" });
	source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
}, 300_000);

describe("a request body with an indexer", () => {
	it("emits both operations, so the arms below compare something", () => {
		expect(source).toContain("x(ctx:");
		expect(source).toContain("y(ctx:");
	});

	it("names the body in the handler's input type rather than intersecting it", () => {
		expect(source).toMatch(/x\(ctx: Ctx, input: [^)]*\{ body: z\.infer<typeof xBody> \}/);
	});

	it("assigns the body at the call site rather than spreading it", () => {
		expect(source).toContain('body: c.req.valid("json")');
	});

	/**
	 * **A form body is named the same way, and is now read from the same slot.**
	 *
	 * This used to assert `c.req.valid("form")`, because a required form body was the one route shape
	 * mounted under its own target. Every body is now mounted by one emitted middleware that publishes
	 * to the canonical body slot whichever reader produced it - so a form body reads exactly as a JSON
	 * one does, and the shape a consumer writes against no longer depends on the media type.
	 *
	 * The claim that survives is the one this arm was written for: the body is NAMED rather than
	 * intersected. That a form body actually parses is asserted by request in `test/wire/wire.test.ts`,
	 * which is where a claim about behaviour belongs.
	 */
	it("names a FORM body too, and reads it from the one body slot", () => {
		expect(source).toMatch(/z\(ctx: Ctx, input: [^)]*\{ body: z\.infer<typeof zBody> \}/);
		expect(source).toContain('body: c.req.valid("json")');
		expect(source).not.toContain('c.req.valid("form")');
	});

	it("still spreads an ordinary model body, so nothing else moved", () => {
		// A named model body reuses its own schema, so the name is `thingSchema` rather than `yBody`.
		// `Fields<>` wraps each intersected member so an EMPTY validator cannot poison the rest; the
		// claim here is unchanged, that an ordinary body is intersected rather than named.
		expect(source).toMatch(
			/y\(ctx: Ctx, input: Fields<z\.infer<typeof yQuery>> & Fields<z\.infer<typeof thingSchema>>/,
		);
	});
});
