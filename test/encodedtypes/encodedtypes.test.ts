import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **What the library's correction of 0.30.0 changes for a route.** See `encodedtypes.tsp`.
 *
 * A property or parameter under `@encode` is validated as the document publishes it: the declared
 * type kept beside the encoded scalar, so an encoded `Color` refuses `"green"` and a nullable one
 * admits `null`. And a discriminated base whose subtype declares no discriminator is validated at
 * all: its validator threw on every parse, so every route carrying it answered 500. It validates as
 * the document's base, and a valid `Cat` comes back as one.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let app: Hono;
let received: unknown;

beforeAll(async () => {
	const compiled = await compileFixture(here, "encodedtypes", { outName: "encodedtypes" });
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
					get: (_target: unknown, name: string) => (_ctx: unknown, input: unknown) => {
						received = input;
						return name === "animal"
							? { status: 200, body: (input as { body?: unknown }).body ?? input }
							: { status: 204 };
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
			invalid: (result: { success: boolean }) =>
				result.success ? undefined : new Response(null, { status: 400 }),
		},
	);
}, 300_000);

const QUERY = "int=5&word=abc&pick=a&inlineUnion=a&rec=a%2C1&at=5&mixed=x";
const BODY = {
	int: "5",
	word: "abc",
	color: "red",
	pick: "a",
	inlineUnion: "a",
	list: "1,2",
	rec: "a,1",
	nullableInt: "5",
	nullableColor: "red",
	at: 5,
	mixed: "x",
};
const post = (path: string, body: unknown) =>
	app.request(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

describe("a parameter or body property under @encode, through the route", () => {
	it("serves an encoded enum's values and refuses any other string", async () => {
		expect((await app.request(`/query?${QUERY}&color=red`)).status).toBe(204);
		expect((await app.request(`/query?${QUERY}&color=green`)).status).toBe(400);
		expect((await app.request("/path/red/abc")).status).toBe(204);
		expect((await app.request("/path/green/abc")).status).toBe(400);
	});

	it("keeps a named scalar's pattern", async () => {
		expect((await app.request("/path/red/ABC")).status).toBe(400);
	});

	it("admits the null a nullable property allows, and refuses a value of the declared type", async () => {
		expect((await post("/body", { ...BODY, nullableInt: null })).status).toBe(204);
		expect((await post("/body", { ...BODY, nullableColor: null })).status).toBe(204);
		expect((await post("/body", { ...BODY, nullableInt: 5 })).status).toBe(400);
		expect((await post("/body", { ...BODY, color: "green" })).status).toBe(400);
	});
});

describe("a discriminated base whose subtype declares no discriminator, through the route", () => {
	it("serves a kind the mapping names, as that subtype, and any other as the base", async () => {
		expect((await post("/animal", { kind: "cat", name: "c", legs: 4, whiskers: 9 })).status).toBe(
			200,
		);
		// A valid `Cat` reaches the handler as one, with what `Cat` and `Mammal` add.
		expect(received).toEqual({ kind: "cat", name: "c", legs: 4, whiskers: 9 });
		expect((await post("/animal", { kind: "bird", name: "b", wingspan: 1 })).status).toBe(200);
		expect((await post("/animal", { kind: "mammal", name: "m", legs: 4 })).status).toBe(200);
		expect(received).toMatchObject({ kind: "mammal", name: "m" });
	});

	it("serves a cat without what Cat requires as an Animal, and refuses a body without a kind", async () => {
		// The document validates an `Animal` position as `Animal` whatever `kind` names.
		expect((await post("/animal", { kind: "cat", name: "c" })).status).toBe(200);
		expect(received).toEqual({ kind: "cat", name: "c" });
		expect((await post("/animal", { name: "n" })).status).toBe(400);
	});
});

describe("a subtype redeclaring a base property, through the route", () => {
	it("refuses what the base's own declaration refuses, as the document's allOf does", async () => {
		expect((await post("/pet", { kind: "dog", name: "rex" })).status).toBe(204);
		expect((await post("/pet", { kind: "dog", name: "rexie" })).status).toBe(400);
	});
});
