import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **What an application can wrap around the routes this emitter mounts.**
 *
 * **Hono middleware applies only to routes registered AFTER it, and `registerRoutes` registers
 * everything at once.** So the one thing a consumer has to know is an ordering rule, and its failure
 * mode is silence: middleware in the wrong place does not error, it simply never runs. Measured on a
 * generated Petstore server, with `app.use` called after `registerRoutes`, a request to
 * `/store/inventory` answered 200 having run exactly one of the four middlewares registered.
 *
 * **This grades OUR output, not Hono.** The emitter decides the shape the routes are mounted in
 * (a sub-app per resource, mounted with a chained `app.route()`) and that shape is what decides
 * whether a prefix wildcard can reach a resource, and whether `c.req.routePath` yields a pattern or a
 * concrete URL. A change to how routes are grouped could take any of these away without failing
 * anything else, which is exactly why they are pinned here.
 *
 * The Sentry question the review asked is answered by the last two arms: a span name needs the route
 * PATTERN rather than the URL, and an error has to reach an app-level handler. Both hold, so
 * instrumenting a generated server needs nothing from this package.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const referenceDir = join(here, "..", "reference");

let build: () => { app: Hono; trace: string[] };

beforeAll(async () => {
	const compiled = await compileFixture(referenceDir, "wire", { outName: "wire-middleware" });
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => Hono;
	};
	build = () => {
		const trace: string[] = [];
		const app = new Hono();
		app.use(async (_c, next) => {
			trace.push("global");
			await next();
		});
		app.use("/items/*", async (_c, next) => {
			trace.push("per-resource");
			await next();
		});
		app.use("/items/json", async (_c, next) => {
			trace.push("per-route");
			await next();
		});
		app.use(async (c, next) => {
			await next();
			trace.push(`routePath=${c.req.routePath}`);
		});
		const handlers = new Proxy(
			{},
			{
				get: (_t, name: string) => (): unknown => {
					if (name === "uploadBlob") throw new Error("boom");
					return { id: "1", label: "ok" };
				},
			},
		);
		const routes = server.registerRoutes(app, () => handlers, {
			authorize: () => async (_c: unknown, next: () => Promise<void>) => {
				await next();
			},
			context: () => ({}),
			noContext: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 401),
			notAcceptable: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 406),
			invalid: (
				result: { success: boolean },
				c: { json: (b: unknown, s: number) => Response },
			): Response | undefined => (result.success ? undefined : c.json(result, 400)),
			respond: (c: { json: (b: unknown) => Response }, _a: unknown, v: unknown) => c.json(v),
		});
		app.onError((error, c) => {
			trace.push(`onError=${error.message}`);
			return c.json({ error: "handled" }, 500);
		});
		return { app: routes, trace };
	};
}, 600_000);

describe("an application can wrap the routes this emitter mounts", () => {
	it("runs global middleware registered before the routes", async () => {
		const { app, trace } = build();
		expect((await app.request("/items/7")).status).toBe(200);
		expect(trace).toContain("global");
	});

	it("runs middleware scoped to one resource, which the sub-app grouping has to allow", async () => {
		/**
		 * **The sub-apps are `const`s inside `registerRoutes`, so there is no handle to `.use()` on.**
		 * A prefix wildcard is the reachable equivalent, and it only works because every route of a
		 * resource is mounted under that resource's prefix. Grouping them any other way would silently
		 * remove per-resource middleware as a possibility.
		 */
		const { app, trace } = build();
		await app.request("/items/7");
		expect(trace).toContain("per-resource");
	});

	it("runs middleware scoped to a single generated path", async () => {
		const { app, trace } = build();
		const response = await app.request("/items/json", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "1", label: "x" }),
		});
		expect(response.status).toBe(200);
		expect(trace).toContain("per-route");
	});

	it("exposes the route PATTERN, not the concrete URL. The span name an app needs", async () => {
		/**
		 * **`/items/7` would be useless as a span name and a cardinality bomb in any tracing
		 * backend.** The pattern is what an application needs, and it survives being mounted through a
		 * sub-app, which is not obvious and is the reason this is asserted rather than assumed.
		 */
		const { app, trace } = build();
		await app.request("/items/7");
		expect(trace).toContain("routePath=/items/:itemId");
	});

	it("lets a handler's throw reach an app-level onError", async () => {
		// Nothing in the generated file swallows it: `deps.respond` is only reached on success.
		const { app, trace } = build();
		const response = await app.request("/items/blob", {
			method: "POST",
			headers: { "content-type": "application/octet-stream" },
			body: new Uint8Array([1, 2, 3]),
		});
		expect(response.status).toBe(500);
		expect(trace).toContain("onError=boom");
	});
});
