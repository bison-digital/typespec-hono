import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A `@cookie` reached no validator, no handler and no diagnostic.**
 *
 * `@typespec/http` discriminates a parameter as `"header" | "cookie" | "query" | "path"`, and the
 * library's filter named three of the four. The exclusion was by omission rather than by a `never`
 * check, so nothing objected. Meanwhile `@typespec/openapi3` published
 * `{"name":"session","in":"cookie","required":true}` and the generated handler's input type was
 * `Record<string, never>`: a requirement the document states, that the server could not read and
 * could not enforce, with a clean compile.
 *
 * A cookie is where a session and a CSRF token normally live, which is what made it worth doing
 * rather than refusing. Hono supports it as a first-class validation target - `ValidationTargets`
 * declares `cookie` and Hono's own validator reads it with `getCookie` - so this is the same
 * `zValidator` call every other group already used.
 *
 * **Asserted by request**, because the emitted text contained `Probe_byCookieResponse200` even when
 * nothing read a cookie: a count of the word would have passed throughout.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let app: Hono;
let source = "";
const received: Record<string, unknown> = {};

beforeAll(async () => {
	const compiled = await compileFixture(here, "cookie");
	expect(compiled.diagnostics).toEqual([]);
	source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	app = new Hono();
	const handlers = new Proxy(
		{},
		{
			get:
				(_target, name: string) =>
				(_ctx: unknown, input: Record<string, unknown>): unknown => {
					received[name] = input;
					return { status: 200, body: { saw: String(input["session"] ?? input["trace"] ?? "") } };
				},
		},
	);
	server.registerRoutes(app, () => handlers, {
		authorize: () => async (_c: unknown, next: () => Promise<void>) => {
			await next();
		},
		context: () => ({}),
		noContext: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 401),
		notAcceptable: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 406),
		invalid: (
			result: { success: boolean },
			c: { json: (b: unknown, s: number) => Response },
		): Response | undefined => (result.success ? undefined : c.json({ envelope: true }, 400)),
	});
}, 600_000);

describe("a cookie the document declares reaches the handler", () => {
	it("hands a required cookie over under its wire name", async () => {
		const response = await app.request("/session", { headers: { cookie: "session=s3cret" } });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ saw: "s3cret" });
		expect(received["Sessions_read"]).toEqual({ session: "s3cret" });
	});

	it("refuses a request without one, which `required: true` is the document saying so", async () => {
		const response = await app.request("/session");
		expect(response.status).toBe(400);
		// Through the app's envelope, like every other request refusal.
		expect(await response.json()).toEqual({ envelope: true });
	});

	it("refuses one carrying a different cookie, rather than reading whatever is there", async () => {
		const response = await app.request("/session", { headers: { cookie: "other=x" } });
		expect(response.status).toBe(400);
	});

	it("lets an OPTIONAL cookie be absent, because the document permits that", async () => {
		const present = await app.request("/session/maybe", { headers: { cookie: "trace=t-1" } });
		expect(present.status).toBe(200);
		expect(await present.json()).toEqual({ saw: "t-1" });
		const absent = await app.request("/session/maybe");
		expect(absent.status).toBe(200);
	});

	it("keeps the groups apart, rather than merging a cookie into the header object", async () => {
		const response = await app.request("/session/mixed?limit=5", {
			headers: { cookie: "session=s3cret", "x-request-id": "r-1" },
		});
		expect(response.status).toBe(200);
		/**
		 * One value per location, each decoded by its own group's schema - `limit` is an `int32` and
		 * arrives as text, so a merged object would have handed the handler a string.
		 */
		expect(received["Sessions_mixed"]).toEqual({
			session: "s3cret",
			"x-request-id": "r-1",
			limit: 5,
		});
	});

	it("mounts it as Hono's own cookie target, not as a header", () => {
		expect(source).toMatch(/zValidator\("cookie", Sessions_readCookie/);
		expect(source).not.toMatch(/zValidator\("header", Sessions_readCookie/);
	});
});
