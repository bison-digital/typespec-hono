import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **An `@encode`d list parameter reaches its handler as the value the document describes.** See
 * `encodedlists.tsp`.
 *
 * The library split a header or path list into an array before validating it as the string its
 * `@encode` makes it, and left a pipe-delimited list of numbers undecoded, so four of the five shapes
 * answered 400 to every request. **The expected values are what `@typespec/openapi3` publishes for
 * each parameter**, and `typespec-http-zod`'s `test/encodedlists`
 * grades the same values against the document itself.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let app: Hono;
let input: unknown;
let refusal: string | undefined;

beforeAll(async () => {
	const compiled = await compileFixture(here, "encodedlists", { outName: "encodedlists" });
	expect(compiled.diagnostics).toEqual([]);
	const { registerRoutes } = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: Hono, handlersFor: unknown, deps: unknown) => Hono;
	};
	app = new Hono();
	registerRoutes(
		app,
		() =>
			new Proxy(
				{},
				{
					get: () => (_ctx: unknown, received: unknown) => {
						input = received;
						return { status: 200, body: { id: "t" } };
					},
				},
			),
		{
			authorize: () => async (_c: unknown, next: () => Promise<void>) => {
				await next();
			},
			context: () => ({}),
			noContext: () => new Response(null, { status: 401 }),
			notAcceptable: () => new Response(null, { status: 406 }),
			invalid: (result: { success: boolean; error?: unknown }) => {
				if (result.success) return undefined;
				refusal = String(result.error).slice(0, 300);
				return new Response(null, { status: 400 });
			},
		},
	);
}, 300_000);

/** operation, the request, its headers, what the handler receives. */
const CASES: readonly (readonly [string, string, Record<string, string>, unknown])[] = [
	["Q: a pipe-delimited query list of numbers", "/q?ids=1%7C2", {}, { ids: [1, 2] }],
	["P: a comma-delimited path list, a string on the wire", "/p/a,b", {}, { ids: "a,b" }],
	[
		"H: a comma-delimited header list, a string on the wire",
		"/h",
		{ "x-tags": "a,b" },
		{ "x-tags": "a,b" },
	],
	["C: a custom-encoded query list, a string on the wire", "/c?tags=a,b", {}, { tags: "a,b" }],
	["S: a comma-delimited query list of strings", "/s?tags=a,b", {}, { tags: ["a", "b"] }],
	[
		"M: an exploded query model with an encoded property",
		"/m?count=5&flag=true",
		{},
		{ filter: { count: "5", flag: true } },
	],
];

describe("each encoded list, sent through the generated route", () => {
	for (const [name, uri, headers, expected] of CASES) {
		it(`${name}: answers 200 and hands the handler ${JSON.stringify(expected)}`, async () => {
			input = undefined;
			refusal = undefined;
			const response = await app.request(uri, { method: "GET", headers });
			expect(refusal).toBeUndefined();
			expect(response.status).toBe(200);
			expect(input).toEqual(expected);
		});
	}
});
