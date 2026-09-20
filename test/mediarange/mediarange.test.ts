import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A declared media RANGE has to admit the types inside it, and it used to admit only its own text.**
 *
 * Two defects met here. `@typespec/http` reports a bare `string`-typed `contentType` as the wildcard
 * range, so the emitted branch list carried that range verbatim; `bodyTarget` compared it to the
 * caller's `Content-Type` by equality, and no caller sends a range as its own content type. Before
 * the media-type check existed the comparison had a fallback to the first branch, which hid it. The
 * check removed the fallback without adding range matching, so every such route answered 400 to
 * every request. Measured on `workerd`: 200 before, 400 after, on a route whose document says the
 * body may be any media type at all.
 *
 * The second is older and independent: a subtype wildcard reached the header validator as
 * `z.literal("text/*")`, so `text/plain` failed there before the body was ever read.
 *
 * **Requests, not emitted text**, for the reason `malformed.test.ts` gives: asserting that output
 * names a branch proves it is wired, not that it answers.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let app: Hono;

beforeAll(async () => {
	const compiled = await compileFixture(here, "mediarange", { outName: "mediarange" });
	expect(compiled.diagnostics).toEqual([]);
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	app = new Hono();
	const handlers = new Proxy(
		{},
		{
			get:
				() =>
				(_ctx: unknown, input: { body?: unknown }): unknown => ({
					status: 200,
					body: { saw: String(input.body) },
				}),
		},
	);
	server.registerRoutes(app, () => handlers, {
		authorize: () => async (_c: unknown, next: () => Promise<void>) => {
			await next();
		},
		context: () => ({}),
		noContext: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 401),
		notAcceptable: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 406),
		invalid: (
			result: { success: boolean },
			c: { json: (b: unknown, s: number) => Response },
		): Response | undefined => (result.success ? undefined : c.json({ envelope: true }, 400)),
	});
}, 600_000);

const send = async (path: string, contentType: string): Promise<number> =>
	(
		await app.request(path, {
			method: "POST",
			headers: { "content-type": contentType },
			body: "hello",
		})
	).status;

/**
 * A request carrying no `Content-Type` at all. `Request` supplies one for a string body, so the
 * body has to be a `Blob` with an empty type for the header to be genuinely absent - which is
 * what a hand-written client sending raw bytes produces.
 */
const sendWithNoContentType = async (path: string): Promise<number> =>
	(await app.request(path, { method: "POST", body: new Blob(["hello"], { type: "" }) })).status;

describe("a request body whose document declares a media range", () => {
	it("admits any media type under the wildcard range", async () => {
		expect(await send("/range/wild", "text/plain")).toBe(200);
		expect(await send("/range/wild", "application/json")).toBe(200);
		expect(await send("/range/wild", "image/png")).toBe(200);
	});

	it("admits every type in a subtype wildcard's group", async () => {
		expect(await send("/range/text", "text/plain")).toBe(200);
		expect(await send("/range/text", "text/html")).toBe(200);
		expect(await send("/range/text", "text/csv")).toBe(200);
	});

	/**
	 * Non-vacuity. A range that admitted everything would pass the two arms above, so the group
	 * boundary is what makes them a claim about ranges rather than about acceptance.
	 */
	it("refuses a type outside the range, so the range is a range and not an escape hatch", async () => {
		expect(await send("/range/text", "application/json")).toBe(400);
		expect(await send("/range/text", "image/png")).toBe(400);
	});

	/**
	 * **No `Content-Type` at all, which the wildcard range would otherwise swallow.**
	 *
	 * An absent header reaches the matcher as the empty string, and `*&#47;*` covers everything
	 * including that - so without an explicit refusal the one route that admits every media type
	 * also admits a request that names none. Measured: deleting the guard left all 345 arms here
	 * green while a headerless request to the wildcard route turned from 400 into 200.
	 *
	 * The CHANGELOG names this as a breaking change: a hand-written client may send nothing.
	 */
	it("refuses a request that names no media type, even on the range that admits them all", async () => {
		expect(await sendWithNoContentType("/range/wild")).toBe(400);
		expect(await sendWithNoContentType("/range/text")).toBe(400);
		expect(await sendWithNoContentType("/range/plain")).toBe(400);
		// The reachable one. Above, the required header validator refuses first; here it does not,
		// so this is the only arm that exercises the matcher's own empty-string guard. Measured:
		// deleting that guard leaves the three routes above answering 400 and turns this into 200.
		expect(await sendWithNoContentType("/range/optional")).toBe(400);
	});

	it("still admits a named media type on that same optional-header route", async () => {
		expect(await send("/range/optional", "text/plain")).toBe(200);
		expect(await send("/range/optional", "application/json")).toBe(200);
	});

	it("leaves a concrete media type admitting only itself", async () => {
		expect(await send("/range/plain", "text/plain")).toBe(200);
		expect(await send("/range/plain", "text/html")).toBe(400);
		expect(await send("/range/plain", "application/json")).toBe(400);
	});

	it("still ignores parameters and matches case-insensitively, as media types are", async () => {
		expect(await send("/range/text", "TEXT/HTML")).toBe(200);
		expect(await send("/range/plain", "text/plain; charset=utf-8")).toBe(200);
	});
});
