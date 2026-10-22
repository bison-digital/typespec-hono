import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A URL-encoded form body is read from the text it carries**, as the document reads it: `n=5` is the
 * `int32` 5. Validated as JSON, every numeric or boolean field of a form was a string, and every
 * conformant request was refused. Where the route takes JSON too, JSON is validated as JSON - a
 * string `"5"` is still no `int32` - so the form's reading is chosen by the request's media type.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let app: Hono;

interface Plain {
	readonly n?: number;
	readonly b?: boolean;
	readonly tags?: readonly number[];
	readonly name?: string;
}

const echo = (_ctx: unknown, input: Plain) => ({
	status: 200,
	body: {
		...(input.n === undefined ? {} : { n: input.n }),
		...(input.b === undefined ? {} : { b: input.b }),
		...(input.tags === undefined ? {} : { tags: input.tags }),
		...(input.name === undefined ? {} : { name: input.name }),
	},
});

beforeAll(async () => {
	compiled = await compileFixture(here, "formbody", { outName: "formbody" });
	const { registerRoutes } = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: Hono, handlersFor: unknown, deps: unknown) => Hono;
	};
	app = new Hono();
	registerRoutes(app, () => ({ form: echo, either: echo }), {
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

const send = (path: string, contentType: string, body: string) =>
	app.request(path, { method: "POST", headers: { "content-type": contentType }, body });
const form = "application/x-www-form-urlencoded";

describe("a URL-encoded form body", () => {
	it("compiles with no error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("reads each field as the value its text spells", async () => {
		for (const path of ["/form", "/either"]) {
			const response = await send(path, form, "n=5&b=true&tags=1&tags=2&name=007");
			expect(response.status, path).toBe(200);
			expect(await response.json(), path).toEqual({ n: 5, b: true, tags: [1, 2], name: "007" });
		}
	});

	it("reads a key sent once as the one-element list it stands for", async () => {
		const response = await send("/form", form, "tags=1");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ tags: [1] });
	});

	it("refuses text that spells no value of the field", async () => {
		expect((await send("/form", form, "n=abc")).status).toBe(400);
		expect((await send("/form", form, "b=yes")).status).toBe(400);
		expect((await send("/form", form, "tags=1&tags=x")).status).toBe(400);
	});

	it("validates JSON as JSON where the route takes it too", async () => {
		const json = "application/json";
		expect((await send("/either", json, JSON.stringify({ n: 5 }))).status).toBe(200);
		expect((await send("/either", json, JSON.stringify({ n: "5" }))).status).toBe(400);
		expect((await send("/either", json, JSON.stringify({ b: "true" }))).status).toBe(400);
	});
});
