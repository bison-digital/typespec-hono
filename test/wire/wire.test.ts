import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **What arrives, as opposed to what was declared.**
 *
 * **Every defect this file guards was invisible to a document comparison, by construction.** The
 * validators agreed with the document throughout; the disagreement was with the wire. Three shipped,
 * and all three were found by sending a real request to a server generated from the Swagger Petstore
 * and running under `wrangler dev`, never by a test:
 *
 * - **a numeric path parameter refused every conformant caller.** `z.number().int()` met `"1"` from
 *   `c.req.param()` and answered 400. `GET /pet/1` and `GET /store/order/1` both 400 while
 *   `GET /user/zach` answered 200, same server, same shape of request;
 * - **every request body was validated as JSON.** `zValidator("json", ...)` reads `c.req.json()`, so a
 *   `multipart/form-data` upload was parsed as JSON and refused, 17 such registrations in
 *   `payload/multipart` alone;
 * - **a raw binary body was read with `c.req.text()`**, which UTF-8-decodes. An 18-byte upload
 *   arrived as 23 code points with five bytes replaced by U+FFFD, and the request answered **200**.
 *
 * **Why this file exists rather than another arm on an existing one.** Every path and query
 * parameter in `reference/service.tsp` is a `string`, and it is the only fixture that made real
 * requests, so the suite emitted 29 numeric query and header parameters across the corpus and
 * requested none of them. An unopened surface, not a narrow arm. `reference/wire.tsp` carries one of
 * each transport encoding, and this sends a request to every one.
 *
 * **Requests, not emitted text.** Asserting that the output contains `zValidator("form", ...)` would
 * pass for a server that still refuses every upload. Only the exchange settles it.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const referenceDir = join(here, "..", "reference");

/** A PNG signature followed by a JPEG header: 18 bytes, five of which are not valid UTF-8. */
const BINARY = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
	0x49, 0x46,
]);

let app: Hono;
/** What each handler actually received, so the assertion is about arrival rather than about status. */
const received: Record<string, unknown> = {};

/**
 * Read a streamed body INSIDE the handler, recording that it was a stream and what it carried.
 *
 * **A binary body reaches the handler unread**, which is the point: the emitter hands over
 * `c.req.raw.body` rather than materialising it, so a 100 MB upload is servable in a 128 MB isolate.
 * That also means it cannot be inspected after the exchange - the request is over by then - so it is
 * drained here, where a real handler would pipe it onward.
 */
async function drained(input: unknown): Promise<unknown> {
	if (typeof input !== "object" || input === null || !("body" in input)) return input;
	const body = (input as { body: unknown }).body;
	if (!(body instanceof ReadableStream)) return input;
	const bytes = new Uint8Array(
		await new Response(body as ReadableStream<Uint8Array>).arrayBuffer(),
	);
	return { ...input, body: { streamed: true, bytes } };
}

beforeAll(async () => {
	const compiled = await compileFixture(referenceDir, "wire", { outName: "wire-requests" });
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	app = new Hono();
	const handlers = new Proxy(
		{},
		{
			get:
				(_target, name: string) =>
				async (_ctx: unknown, input: unknown): Promise<unknown> => {
					received[name] = await drained(input);
					return { id: "1", label: "ok" };
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
		): Response | undefined => (result.success ? undefined : c.json(result, 400)),
		respond: (c: { json: (b: unknown) => Response }, _arms: unknown, value: unknown) =>
			c.json(value),
	});
}, 600_000);

describe("the generated server accepts what the wire actually carries", () => {
	it("accepts a numeric path parameter, which arrives as text", async () => {
		const response = await app.request("/items/7");
		expect(response.status).toBe(200);
		// Decoded, not merely accepted: the handler must see a number, or the contract is a lie.
		expect(received["readItem"]).toMatchObject({ itemId: 7 });
	});

	it("still refuses a path parameter that is not a number at all", async () => {
		// The decode must not become a coercion: `"abc"` has no numeric reading and must fail.
		expect((await app.request("/items/abc")).status).toBe(400);
	});

	it("accepts numeric and boolean query parameters", async () => {
		const response = await app.request("/items/7?limit=5&ratio=0.5&expand=true");
		expect(response.status).toBe(200);
		expect(received["readItem"]).toMatchObject({ limit: 5, ratio: 0.5, expand: true });
	});

	it("accepts a numeric query parameter whose type is a union of literals", async () => {
		/**
		 * **The shape that emits `z.union([z.literal(10), ...])` rather than `z.number()`.** The
		 * library chose whether to decode by reading the emitted expression, so this parameter got
		 * none and answered 400 to every conformant caller. Fixed in `typespec-http-zod@0.6.0`; this
		 * arm is what proves the fix reaches a request rather than only the validator.
		 */
		const response = await app.request("/paged?size=25");
		expect(response.status).toBe(200);
		expect(received["listPaged"]).toMatchObject({ size: 25 });
	});

	it("still refuses a value the union does not permit, so nothing was loosened", async () => {
		expect((await app.request("/paged?size=99")).status).toBe(400);
	});

	it("accepts a content-type carrying the parameters a media type is allowed to carry", async () => {
		/**
		 * **`z.literal("application/json")` refuses `application/json; charset=utf-8`**, which is
		 * entirely legal and extremely common. The same defect made every multipart request fail, because
		 * RFC 2046 section 5.1.1 makes the boundary parameter MANDATORY there.
		 */
		const response = await app.request("/items/json", {
			method: "POST",
			headers: { "content-type": "application/json; charset=utf-8" },
			body: JSON.stringify({ id: "1", label: "x" }),
		});
		expect(response.status).toBe(200);
	});

	it("refuses a media type the document does not offer, so nothing was loosened", async () => {
		const response = await app.request("/items/json", {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body: "{}",
		});
		expect(response.status).toBe(400);
	});

	/**
	 * **The two arms below are the only thing that proves a dispatched body is served.**
	 *
	 * An operation declaring both a JSON and a form-encoded body needs a different parser per request,
	 * and `zValidator`'s target is fixed when the file is generated. Before this fixture existed,
	 * `byContentType(` occurred **zero** times across 356 generated `app.gen.ts` files, so truncating
	 * the dispatch in `src/` left the entire suite green. Asserting the emitted text would not have
	 * been enough either: the emitted code did not compile, and would still have contained the call.
	 */
	it("accepts a JSON body on an operation that also accepts a form", async () => {
		const response = await app.request("/items/either", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "1", label: "from json" }),
		});
		expect(response.status).toBe(200);
		expect(received["createFromEither"]).toMatchObject({ id: "1", label: "from json" });
	});

	it("accepts a form-encoded body on the same operation, which is the dispatch", async () => {
		const response = await app.request("/items/either", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ id: "2", label: "from form" }),
		});
		expect(response.status).toBe(200);
		// Decoded, not merely accepted: a 200 with an empty body would mean the parser never ran.
		expect(received["createFromEither"]).toMatchObject({ id: "2", label: "from form" });
	});

	it("still refuses a body whose media type the operation does not declare", async () => {
		const response = await app.request("/items/either", {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body: "id=3&label=nope",
		});
		expect(response.status).toBe(400);
	});

	it("accepts a real multipart upload, boundary and all", async () => {
		const form = new FormData();
		form.set("file", new Blob([BINARY], { type: "image/png" }), "p.png");
		form.set("caption", "a good dog");
		const response = await app.request("/items/upload", { method: "POST", body: form });
		expect(response.status).toBe(200);
	});

	it("hands a binary body to the handler unchanged, byte for byte", async () => {
		/**
		 * **The assertion is byte IDENTITY, not length.** A first attempt at measuring this compared
		 * counts and passed: the corrupted body happened to have the same number of code points as the
		 * original had bytes. Only comparing the bytes themselves shows `0x89` arriving as U+FFFD.
		 */
		const response = await app.request("/items/blob", {
			method: "POST",
			headers: { "content-type": "application/octet-stream" },
			body: BINARY,
		});
		expect(response.status).toBe(200);
		const body = (received["uploadBlob"] as { body: { streamed: boolean; bytes: Uint8Array } })
			.body;
		/**
		 * **Unread when it arrives.** It used to be `await c.req.arrayBuffer()`, which materialises
		 * the whole payload: a Worker isolate is 128 MB against a request-body limit of 100 MB, so an
		 * upload at the documented maximum could not be served at all. The document publishes only
		 * `contentMediaType` for such a body, so nothing about it was validated either - the emitter
		 * was paying the entire cost of reading it to produce a value nothing checked.
		 */
		expect(body.streamed, "the body was materialised before the handler saw it").toBe(true);
		// Byte IDENTITY, not length. The original defect was `c.req.text()` UTF-8-decoding five of
		// these eighteen bytes into U+FFFD while answering 200, and a count comparison passed.
		expect([...body.bytes]).toEqual([...BINARY]);
	});
});
