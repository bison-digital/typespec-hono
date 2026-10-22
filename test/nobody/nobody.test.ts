import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A response declared `@body body: void` is served with no body and no media type.** See
 * `nobody.tsp`. The library listed `application/json` for it beside no schema, which reads as a body
 * nothing can validate; a `void` request body refused the compile outright. A `never` body is refused by the library as `never-body`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let app: Hono;
let returned: unknown;

beforeAll(async () => {
	const compiled = await compileFixture(here, "nobody", { outName: "nobody" });
	expect(compiled.diagnostics).toEqual([]);
	const { registerRoutes } = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: Hono, handlersFor: unknown, deps: unknown) => Hono;
	};
	app = new Hono();
	registerRoutes(app, () => new Proxy({}, { get: () => () => returned }), {
		authorize: () => async (_c: unknown, next: () => Promise<void>) => {
			await next();
		},
		context: () => ({}),
		noContext: () => new Response(null, { status: 401 }),
		notAcceptable: () => new Response(null, { status: 406 }),
		invalid: (result: { success: boolean }) =>
			result.success ? undefined : new Response(null, { status: 400 }),
	});
}, 300_000);

describe("a response with no body", () => {
	for (const status of [409]) {
		it(`serves the ${status} it declares with no body and no media type`, async () => {
			returned = { status };
			const response = await app.request("/responses", { method: "GET" });
			expect(response.status).toBe(status);
			expect(response.headers.get("content-type")).toBeNull();
			expect(await response.text()).toBe("");
		});
	}
});

describe("a request declared with no body", () => {
	it("is served without reading one", async () => {
		returned = { status: 200, body: { id: "t" } };
		for (const path of ["/void"]) {
			const response = await app.request(path, { method: "POST" });
			expect(response.status).toBe(200);
		}
	});
});
