import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * **Every request `@typespec/http-specs` declares for its route scenarios reaches the operation it
 * was written for, with the value the scenario documents.**
 *
 * `routes` is the corpus's RFC 6570 scenario: simple, path, label, matrix and reserved expansion,
 * exploded and not, over a primitive, a list and a record, plus query expansion and a literal query
 * string continued by a parameter. Its `mockapi.ts` states the exact URI each operation is called
 * with. Before this suite, 33 of those 47 URIs answered 404 or 400 from a server generated from the
 * scenario, because routes were mounted from a `path` with every operator stripped, and path lists,
 * records and form-exploded query objects were never decoded. `parameters/path` adds `optional{/name}`.
 *
 * **Nothing here comes from this package.** The URIs are the mock's, sent unchanged; the values are
 * the ones the scenario documents; and `routes` has no OpenAPI document at all (`@typespec/openapi3`
 * refuses it with `path-query`), which is why no document-graded suite ever reached it.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const specs = fileURLToPath(
	new URL("../../node_modules/@typespec/http-specs/specs/", import.meta.url),
);

/**
 * What each `routes` operation is documented to receive, by the last word of its scenario name. The
 * two fixed routes (`Routes_fixed`, `Routes_InInterface`) take no parameter at all.
 */
function documentedFor(scenarioName: string, uri: string): unknown {
	if (uri.endsWith("/fixed")) return undefined;
	if (/ReservedExpansion/.test(scenarioName)) return "foo/bar baz";
	const operation = scenarioName.split("_").at(-1);
	switch (operation) {
		case "array":
			return ["a", "b"];
		case "record":
			return { a: 1, b: 2 };
		case "model":
			return { field: "status", value: "active" };
		default:
			return "a";
	}
}

interface Sent {
	readonly uri: string;
	readonly status: number;
	readonly reached: boolean;
	readonly input: Record<string, unknown> | undefined;
	readonly refusal: string | undefined;
}

async function serve(scenario: string): Promise<(uri: string) => Promise<Sent>> {
	const outDir = join(here, ".out-uris", scenario.replaceAll("/", "__"));
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
	let reached = false;
	let input: Record<string, unknown> | undefined;
	let refusal: string | undefined;
	const app = new Hono();
	type Context = { json: (body: unknown, status: number) => Response };
	server.registerRoutes(
		app,
		() =>
			new Proxy(
				{},
				{
					get: () => (_ctx: unknown, received: Record<string, unknown>) => {
						reached = true;
						input = received;
						return { status: 204 };
					},
				},
			),
		{
			authorize: () => async (_c: Context, next: () => Promise<void>) => {
				await next();
				return undefined;
			},
			context: () => ({}),
			noContext: (c: Context) => c.json({}, 401),
			notAcceptable: (c: Context) => c.json({}, 406),
			invalid: (result: { success: boolean; error?: unknown }, c: Context) => {
				if (result.success) return undefined;
				refusal = String(result.error).slice(0, 300);
				return c.json({}, 400);
			},
		},
	);
	return async (uri) => {
		reached = false;
		input = undefined;
		refusal = undefined;
		const response = await app.request(uri);
		return { uri, status: response.status, reached, input, refusal };
	};
}

describe("http-specs routes: every mock URI reaches its operation with the documented value", () => {
	let results: { readonly scenario: string; readonly sent: Sent }[] = [];

	beforeAll(async () => {
		const send = await serve("routes");
		const mock = readFileSync(join(specs, "routes", "mockapi.ts"), "utf8");
		const collected: { scenario: string; sent: Sent }[] = [];
		for (const [, scenario, uri] of mock.matchAll(
			/Scenarios\.(\w+) = createTests\(\s*"([^"]+)"/g,
		)) {
			collected.push({ scenario: scenario ?? "", sent: await send(uri ?? "") });
		}
		results = collected;
	}, 300_000);

	it("sent every URI the mock declares", () => {
		expect(results).toHaveLength(47);
	});

	it("reaches a handler for every one", () => {
		expect(
			results
				.filter(({ sent }) => !sent.reached)
				.map(({ sent }) => `${sent.status} ${sent.uri} ${sent.refusal ?? ""}`),
		).toEqual([]);
	});

	it("hands each handler the value its scenario documents", () => {
		const wrong = results.flatMap(({ scenario, sent }) => {
			const expected = documentedFor(scenario, sent.uri);
			const actual = sent.input?.["param"];
			return JSON.stringify(actual) === JSON.stringify(expected)
				? []
				: [
						`${scenario} ${sent.uri}: ${JSON.stringify(actual)}, documented ${JSON.stringify(expected)}`,
					];
		});
		expect(wrong).toEqual([]);
	});

	it("still answers 404 or 400 to a URI the route does not declare", async () => {
		const send = await serve("routes");
		// The operator is missing, and the literal query string the route requires is absent.
		for (const uri of [
			"/routes/path/label/standard/primitivea",
			"/routes/path/matrix/standard/primitive;other=a",
			"/routes/query/query-continuation/standard/primitive?param=a",
		]) {
			const sent = await send(uri);
			expect(sent.reached, uri).toBe(false);
			expect([400, 404], uri).toContain(sent.status);
		}
	}, 300_000);
});

describe("http-specs parameters/path: an optional segment is reachable with and without its value", () => {
	it("routes /normal/foo, /optional and /optional/foo", async () => {
		const send = await serve("parameters/path");
		const normal = await send("/parameters/path/normal/foo");
		expect(normal.reached, normal.uri).toBe(true);
		expect(normal.input?.["name"]).toBe("foo");
		const absent = await send("/parameters/path/optional");
		expect(absent.reached, absent.uri).toBe(true);
		expect(absent.input?.["name"]).toBeUndefined();
		const present = await send("/parameters/path/optional/foo");
		expect(present.reached, present.uri).toBe(true);
		expect(present.input?.["name"]).toBe("foo");
	}, 300_000);
});
