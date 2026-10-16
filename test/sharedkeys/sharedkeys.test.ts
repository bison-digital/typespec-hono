import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **An operation two of whose inputs would reach the handler under one key is not mounted.** See
 * `sharedkeys.tsp`.
 *
 * The handler is called with the groups spread into one input, so `@header("x")` beside
 * `@query("x")` was served with the header's string replacing the validated number, and the input
 * typed `number & string` (typespec-http-graphql, 2026-10-16). `typespec-http-zod` names the pair; this
 * server reports it and leaves the route unmounted.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let app: Hono;
const reached: string[] = [];

/** operation, its request, the location declared first and second, and the key. */
const PAIRS: readonly (readonly [string, string, string, string, string, string])[] = [
	["headerQuery", "GET", "/header-query?x=1", "header", "query parameter", "x"],
	["queryQuery", "GET", "/query-query?x=1", "query parameter", "query parameter", "x"],
	[
		"queryQueryAgreeing",
		"GET",
		"/query-query-agreeing?y=v",
		"query parameter",
		"query parameter",
		"y",
	],
	["pathHeader", "GET", "/path-header/1", "path parameter", "header", "id"],
	["cookieQuery", "GET", "/cookie-query?session=s", "cookie", "query parameter", "session"],
	["queryBody", "POST", "/query-body?body=b", "query parameter", "body", "body"],
];

beforeAll(async () => {
	compiled = await compileFixture(here, "sharedkeys", { outName: "sharedkeys" });
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
					get: (_target: unknown, name: string) => () => {
						reached.push(name);
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
			invalid: (result: { success: boolean }) =>
				result.success ? undefined : new Response(null, { status: 400 }),
		},
	);
}, 300_000);

describe("two inputs under one key", () => {
	it("is reported by the library and refused by this server, once each per operation", () => {
		const codes = compiled.diagnostics.map((d) => d.code);
		expect(codes.filter((code) => code === "typespec-http-zod/shared-input-key")).toHaveLength(
			PAIRS.length,
		);
		expect(codes.filter((code) => code === "typespec-hono/shared-input-key")).toHaveLength(
			PAIRS.length,
		);
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	for (const [operation, method, uri, first, second, key] of PAIRS) {
		it(`${operation}: names the ${first} and the ${second} '${key}', and is not mounted`, async () => {
			const message = compiled.diagnostics.find(
				(d) =>
					d.code === "typespec-hono/shared-input-key" && d.message.startsWith(`'${operation}' `),
			)?.message;
			expect(message).toContain(`its ${first} '${key}' and its ${second} '${key}'`);
			const response = await app.request(uri, {
				method,
				headers: { id: "2", cookie: "session=c", "content-type": "application/json" },
				...(method === "POST" ? { body: JSON.stringify([{ id: "t" }]) } : {}),
			});
			expect(response.status).toBe(404);
		});
	}

	it("still mounts an operation whose inputs are all distinct", async () => {
		const response = await app.request("/control?y=1", { method: "GET", headers: { x: "a" } });
		expect(response.status).toBe(200);
		expect(reached).toEqual(["control"]);
	});
});
