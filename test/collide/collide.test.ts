import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/** **A path parameter is not replaced by a body key of the same name.** See `collide.tsp`. */

const here = fileURLToPath(new URL(".", import.meta.url));
const received: Record<string, unknown> = {};
let app: Hono;

beforeAll(async () => {
	const compiled = await compileFixture(here, "collide", { outName: "collide" });
	expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	const { registerRoutes } = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: Hono, handlersFor: unknown, deps: unknown) => Hono;
	};
	const record = (name: string) => (_ctx: unknown, input: unknown) => {
		received[name] = input;
		return { status: 204 };
	};
	app = new Hono();
	registerRoutes(app, () => ({ add: record("add"), rename: record("rename") }), {
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

const send = (method: string, path: string, body: unknown) =>
	app.request(path, {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

describe("a body key equal to a path parameter's name", () => {
	it("hands the handler both values, the path's under its own name", async () => {
		const response = await send("POST", "/shelves/1/books", { shelfId: 2, title: "Dune" });
		expect(response.status).toBe(204);
		expect(received["add"]).toEqual({ shelfId: 1, body: { shelfId: 2, title: "Dune" } });
	});

	it("names a body whose like-named property is read-only, which the document still requires", async () => {
		const response = await send("PUT", "/shelves/1", { shelfId: 1, label: "fiction" });
		expect(response.status).toBe(204);
		expect(received["rename"]).toEqual({ shelfId: 1, body: { shelfId: 1, label: "fiction" } });
		// Required in the request too, as the document publishes it: a body without one is refused.
		expect((await send("PUT", "/shelves/1", { label: "fiction" })).status).toBe(400);
	});
});
