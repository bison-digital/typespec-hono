import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **Every rejection this server produces must be one its own document describes.**
 *
 * See `malformed.tsp` for the three positions and what mounts each. The claim under test is one
 * sentence: a body that cannot be read is refused through `deps.invalid`, like every other
 * rejection, so the app's error envelope holds.
 *
 * **Requests, not emitted text.** Asserting that the emitted output names a middleware proves it is
 * wired, not that it works - which is exactly how four content-negotiation defects shipped. Every
 * arm below fires a real request and reads the response's content type and body.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let app: Hono;
const received: Record<string, unknown> = {};

beforeAll(async () => {
	const compiled = await compileFixture(here, "malformed", { outName: "malformed" });
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	app = new Hono();
	const handlers = new Proxy(
		{},
		{
			get:
				(_target, name: string) =>
				(_ctx: unknown, input: unknown): unknown => {
					received[name] = input;
					return undefined;
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
		/**
		 * The app's envelope. Anything answering 400 without passing through here has escaped it, and
		 * the arms below tell the two apart by content type: this one is JSON, `HTTPException`'s
		 * default is `text/plain`.
		 */
		invalid: (
			result: { success: boolean },
			c: { json: (b: unknown, s: number) => Response },
		): Response | undefined => (result.success ? undefined : c.json({ envelope: true }, 400)),
		respond: (c: { body: (b: null, s: number) => Response }) => c.body(null, 204),
	});
}, 600_000);

/** A body that is not the JSON its content type claims. */
const malformedJson = {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: "{",
};

/**
 * A body that is not the multipart its content type claims. `bufferToFormData` builds a `Response`
 * and calls `formData()` on it, which rejects for a payload carrying no boundary marker.
 */
const malformedForm = {
	method: "POST",
	headers: { "content-type": "multipart/form-data; boundary=abc" },
	body: "not a multipart body",
};

describe("a body that cannot be read is refused through the app's envelope", () => {
	it("refuses a malformed body on a REQUIRED single-media-type operation", async () => {
		const response = await app.request("/required", malformedJson);
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ envelope: true });
	});

	it("refuses one on an OPTIONAL operation, which already held", async () => {
		const response = await app.request("/optional", malformedJson);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ envelope: true });
	});

	/**
	 * **The FORM reader can fail too, and only the JSON one was guarded.** Hono's own validator
	 * catches in both branches and throws `HTTPException` from each; this package's reader caught the
	 * JSON rejection and let the form one through, so an unreadable multipart body threw straight out
	 * of the middleware. Measured before the fix: **500**, from
	 * `TypeError: Failed to parse body as FormData` - worse than the 400 the JSON case produced, and
	 * outside the envelope in the same way.
	 *
	 * Multipart rather than urlencoded, and that took measuring: `formData()` throws for every
	 * malformed multipart payload tried and for no urlencoded one, so a urlencoded fixture would look
	 * like it covered this and never reach the failure.
	 */
	it("refuses an unreadable FORM body, which used to throw rather than answer", async () => {
		const response = await app.request("/form", malformedForm);
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ envelope: true });
	});
});

/**
 * **Non-vacuity.** Every arm above would pass for a server that answered `{envelope: true}` to
 * everything, or that never validated a body at all.
 */
describe("the body is still validated", () => {
	it("accepts a well-formed body and hands it to the handler", async () => {
		const response = await app.request("/required", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ note: "hello" }),
		});
		expect(response.status).toBe(204);
		expect(received["required"]).toEqual({ note: "hello" });
	});

	it("still refuses a well-formed body that is wrong, through the same envelope", async () => {
		const response = await app.request("/required", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ note: 42 }),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ envelope: true });
	});

	it("accepts a well-formed FORM body", async () => {
		const form = new FormData();
		form.set("note", "hello");
		const response = await app.request("/form", { method: "POST", body: form });
		expect(response.status).toBe(204);
		// The declared `contentType` header is part of the input too, so this is a floor not an equality.
		expect(received["form"]).toMatchObject({ note: "hello" });
	});
});
