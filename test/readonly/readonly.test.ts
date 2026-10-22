import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A create body may leave out a server-assigned read-only `id` where openapi3 publishes OpenAPI
 * 3.0, its default.** OAS 3.0.4 says a required read-only property's `required` "will take effect
 * on the response only". On `typespec-http-zod` 0.31.0 every such route read the request as 3.1
 * does, required the `id`, and answered a conformant create with 400. At 3.1 `readOnly` is an
 * annotation and the `id` is required in the request as well, which the route enforces too.
 *
 * **Requests, not emitted text**: each arm sends one through the generated routes and reads the
 * status, with the handler answering the widget it was handed.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

async function appAt(versions: readonly string[] | null): Promise<Hono> {
	const compiled = await compileFixture(here, "readonly", {
		outName: `readonly-${versions?.join("_") ?? "default"}`,
		openapiVersions: versions,
	});
	expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	const app = new Hono();
	server.registerRoutes(
		app,
		() => ({
			// The body is the input, merged: a handler receives the widget the request validated.
			create: (_ctx: unknown, input: Record<string, unknown>) => ({
				status: 201,
				body: {
					...input,
					id: "w1",
					items: (input["items"] as Record<string, unknown>[]).map((item, index) => ({
						...item,
						id: `i${String(index)}`,
					})),
				},
			}),
		}),
		{
			authorize: () => async (_c: unknown, next: () => Promise<void>) => {
				await next();
			},
			context: () => ({}),
			noContext: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 401),
			notAcceptable: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 406),
			invalid: (result: { success: boolean }, c: { json: (b: unknown, s: number) => Response }) =>
				result.success ? undefined : c.json({ invalid: true }, 400),
		},
	);
	return app;
}

const post = (app: Hono, body: unknown): Promise<Response> =>
	Promise.resolve(
		app.request("/widgets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);

const withoutIds = { name: "a", items: [{ label: "x" }] };
const withIds = { id: "client", name: "a", items: [{ id: "client", label: "x" }] };

describe("a create body and its server-assigned read-only id", () => {
	it("is created without the id where openapi3 publishes 3.0, its default", async () => {
		const app = await appAt(null);
		const created = await post(app, withoutIds);
		expect(created.status).toBe(201);
		expect(await created.json()).toEqual({
			id: "w1",
			name: "a",
			items: [{ id: "i0", label: "x" }],
		});
		expect((await post(app, withIds)).status).toBe(201);
		expect((await post(app, { items: [] })).status).toBe(400);
	});

	it("is refused without the id where openapi3 publishes 3.1, whose request requires it", async () => {
		const app = await appAt(["3.1.0"]);
		expect((await post(app, withoutIds)).status).toBe(400);
		expect((await post(app, withIds)).status).toBe(201);
	});
});
