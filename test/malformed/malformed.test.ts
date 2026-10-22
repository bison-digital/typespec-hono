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
	refusals.length = 0;
	const handlers = new Proxy(
		{},
		{
			get:
				(_target, name: string) =>
				(_ctx: unknown, input: unknown): unknown => {
					received[name] = input;
					return { status: 204 };
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
		): Response | undefined => {
			if (result.success) return undefined;
			refusals.push(result);
			return c.json({ envelope: true }, 400);
		},
	});
}, 600_000);

/** Every result `deps.invalid` was handed, so an arm can read what a refusal TELLS the caller. */
const refusals: { success: boolean; error?: { issues?: { message?: string }[] } }[] = [];

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

	/**
	 * **The optional path and the form reader together, which no fixture could carry before.**
	 *
	 * `optionalBody` and `zValidator` call one reader, so this is the only route that reaches its
	 * form branch through the optional mounting. The shape was unavailable while an optional
	 * multipart body emitted a server that did not compile; `optional-form` in the fixture records
	 * that.
	 */
	it("refuses an unreadable body on an OPTIONAL FORM operation", async () => {
		const response = await app.request("/optional-form", malformedForm);
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ envelope: true });
	});

	/**
	 * **Non-vacuity for the arm above, and the naming proved by request rather than by type.**
	 *
	 * The arm above would pass against a server that refused everything on that route. This one
	 * requires a well-formed body to be accepted, and requires it to reach the handler UNDER `body`
	 * rather than merged into the input beside the header. A merged shape would satisfy every
	 * type-level arm in `test/optionalmultipart/` only if the emitter also changed the signature, so
	 * this is the runtime half of the same claim.
	 *
	 * `@header contentType` is declared and required, so a header-less request is refused by the
	 * HEADER validator before any of this is reached. `FormData` sets the header with its boundary,
	 * which is why the request is built this way rather than by hand.
	 */
	it("accepts a well-formed body on that operation and hands it over NAMED", async () => {
		const form = new FormData();
		form.set("note", "hello");
		const response = await app.request("/optional-form", { method: "POST", body: form });
		expect(response.status).toBe(204);
		expect(received["optionalForm"]).toMatchObject({ body: { note: "hello" } });
	});
});

/**
 * **Non-vacuity.** Every arm above would pass for a server that answered `{envelope: true}` to
 * everything, or that never validated a body at all.
 */
describe("a media type the document does not publish is refused", () => {
	/**
	 * **The route used to accept the body whatever the header said.** `bodyTarget` fell through to the
	 * first declared branch, and the emitter's own comment claimed the body would then "simply fail to
	 * parse" - which it does not: `c.req.json()` reads the bytes regardless. Measured on a generated
	 * server under `workerd`, an operation publishing `application/json` alone answered **200** to the
	 * same JSON body sent as `text/plain`, as `multipart/form-data`, and with no `Content-Type` at all.
	 *
	 * `@typespec/http-server-js`, TypeSpec's own reference server, refuses the identical case through
	 * its `onInvalidRequest` hook, which is what `deps.invalid` is here.
	 */
	const body = JSON.stringify({ note: "ok" });

	it("refuses a declared body sent as a media type the operation does not accept", async () => {
		for (const contentType of ["text/plain", "multipart/form-data", "application/xml"]) {
			const response = await app.request("/required", {
				method: "POST",
				headers: { "content-type": contentType },
				body,
			});
			expect(response.status, contentType).toBe(400);
			// Through the app's envelope, like every other refusal, rather than Hono's own answer.
			expect(await response.json(), contentType).toEqual({ envelope: true });
		}
	});

	it("refuses one carrying no content type at all", async () => {
		const response = await app.request("/required", { method: "POST", body });
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ envelope: true });
	});

	it("still accepts the media type the document DOES publish, parameters and all", async () => {
		/**
		 * The control, and the half that matters most: a refusal that also refuses conformant requests
		 * is not a fix. `; charset=utf-8` is not part of the match, which is why it is here.
		 */
		for (const contentType of ["application/json", "application/json; charset=utf-8"]) {
			const response = await app.request("/required", {
				method: "POST",
				headers: { "content-type": contentType },
				body,
			});
			expect(response.status, contentType).toBe(204);
		}
	});

	it("names what the operation accepts, so a caller can act on the refusal", async () => {
		/**
		 * A refusal that says only "no" leaves the caller guessing which of their assumptions was
		 * wrong. The document knows the answer, so the issue carries it.
		 */
		refusals.length = 0;
		const response = await app.request("/required", {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body,
		});
		expect(response.status).toBe(400);
		const issues = refusals.at(-1)?.error?.issues ?? [];
		expect(issues.map((issue) => issue.message)).toEqual([
			"this operation accepts application/json",
		]);
	});
});

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
