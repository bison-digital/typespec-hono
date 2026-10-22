import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * **A handler returning the body `@typespec/http-specs` declares for a discriminated base is served.**
 *
 * `type/model/inheritance/enum-discriminator`, `single-discriminator` and `nested-discriminator`
 * each answer one operation with a body whose discriminator names no subtype. The library refused it
 * against the response arm, so the handler's own return failed the response contract and answered
 * 500. The document's base admits it: OAS 3.1.1 section 4.8.25,
 * `discriminator` "MUST NOT change the validation outcome of the schema". A closed discriminator still
 * refuses a value outside it, through the base's own `kind`.
 *
 * **The bodies are the mocks' own**, and `typespec-http-zod`'s `test/polymorphism/scenarios.test.ts`
 * grades each against the document.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const specs = fileURLToPath(
	new URL("../../node_modules/@typespec/http-specs/specs/type/model/inheritance/", import.meta.url),
);

/** Serve one scenario, every handler answering 200 with `body`. */
async function serve(scenario: string): Promise<(uri: string, body: unknown) => Promise<number>> {
	const outDir = join(here, ".out-discriminators", scenario);
	rmSync(outDir, { recursive: true, force: true });
	const program = await compile(NodeHost, join(specs, scenario, "main.tsp"), {
		outputDir: outDir,
		emit: ["typespec-hono"],
		options: {
			"typespec-hono": {
				"emitter-output-dir": outDir,
				"contracts-output-dir": outDir,
				"contracts-package": "./vocabularies.gen.js",
				"seal-object-schemas": true,
			},
		},
	});
	expect(program.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	const server = (await import(join(outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	let body: unknown;
	const app = new Hono();
	server.registerRoutes(app, () => new Proxy({}, { get: () => () => ({ status: 200, body }) }), {
		authorize: () => async (_c: unknown, next: () => Promise<void>) => {
			await next();
		},
		context: () => ({}),
		noContext: () => new Response(null, { status: 401 }),
		notAcceptable: () => new Response(null, { status: 406 }),
		invalid: (result: { success: boolean }) =>
			result.success ? undefined : new Response(null, { status: 400 }),
	});
	return async (uri, returned) => {
		body = returned;
		return (await app.request(uri, { method: "GET" })).status;
	};
}

/** scenario, the mock's URI, the mock's body, the status a server answers. */
const CASES: readonly (readonly [string, string, unknown, number])[] = [
	[
		"enum-discriminator",
		"/type/model/inheritance/enum-discriminator/extensible-enum/wrongdiscriminator",
		{ weight: 8, kind: "wrongKind" },
		200,
	],
	[
		"enum-discriminator",
		"/type/model/inheritance/enum-discriminator/fixed-enum/wrongdiscriminator",
		{ length: 8, kind: "wrongKind" },
		500,
	],
	[
		"single-discriminator",
		"/type/model/inheritance/single-discriminator/wrongdiscriminator",
		{ wingspan: 1, kind: "wrongKind" },
		200,
	],
	[
		"nested-discriminator",
		"/type/model/inheritance/nested-discriminator/wrongdiscriminator",
		{ age: 1, kind: "wrongKind" },
		200,
	],
];

const servers = new Map<string, Awaited<ReturnType<typeof serve>>>();

beforeAll(async () => {
	for (const scenario of new Set(CASES.map(([name]) => name))) {
		servers.set(scenario, await serve(scenario));
	}
}, 300_000);

describe("a body naming no subtype, returned by the handler", () => {
	for (const [scenario, uri, body, status] of CASES) {
		it(`${scenario} ${uri.split("/").slice(-2).join("/")}: answers ${status}`, async () => {
			const send = servers.get(scenario);
			expect(await send?.(uri, body)).toBe(status);
		});
	}
});
