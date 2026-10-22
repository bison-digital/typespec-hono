import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **An operation id is a valid id and not always an identifier.** See `opids.tsp`.
 *
 * `@operationId("get.widget")` named its result type `Get.widgetResult` and its handler alias
 * `Get.widgetHandler`, and the route called `handlersFor(c).get.widget(...)`: the module did not
 * parse. Each type name is the id with every character no identifier may hold made `_`, as the
 * library names the same operation's validators, and unique; the handler is called by its key.
 * `compiles.test.ts` typechecks the emitted set.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let source: string;
let app: Hono;
const called: string[] = [];

beforeAll(async () => {
	const compiled = await compileFixture(here, "opids", { outName: "opids" });
	expect(compiled.diagnostics).toEqual([]);
	source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
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
						called.push(name);
						return { status: 204 };
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
			invalid: () => undefined,
		},
	);
}, 300_000);

describe("an operation id that is not an identifier", () => {
	it("names each operation's types as identifiers, no two alike", () => {
		const aliases = [
			...source.matchAll(/export type (\S+)Handler<C = unknown> = Operations<C>\[/g),
		].map((match) => match[1] ?? "");
		expect(aliases).toEqual(["Get_widget", "Get_widget_", "_1st", "List__items", "X_y"]);
	});

	it("calls each handler by its own id", async () => {
		for (const path of ["/a", "/b", "/c", "/d", "/e"]) {
			expect((await app.request(path)).status).toBe(204);
		}
		expect(called).toEqual(["get.widget", "get_widget", "1st", "list*/items", "x-y"]);
	});
});
