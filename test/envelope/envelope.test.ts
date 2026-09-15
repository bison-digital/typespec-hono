import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **Every kind of declared response, served by request.** See `envelope.tsp`.
 *
 * A handler returns `{ status, body, headers }`, and the generated route serves it through the Hono
 * call for that response. These arms send real requests, because asserting that the emitted text
 * mentions `c.json` would pass for a server answering 200 to everything.
 *
 * **Compiled with sealing OFF**, so a closed model is `z.object`, which strips a key the document does
 * not declare. That is what lets the projection arm below show that what is served is the PARSED
 * body. The sealed case, where such a key is refused instead, is `test/wiring/`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let app: Hono;
const thrown: unknown[] = [];

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xd8]);

beforeAll(async () => {
	compiled = await compileFixture(here, "envelope", {
		outName: "envelope",
		extraOptions: { "seal-object-schemas": false },
	});
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	app = new Hono();
	app.onError((error, c) => {
		thrown.push(error);
		return c.json({ error: error.name }, 500);
	});
	const item = { id: "1", label: "one" };
	const handlers = {
		// The handler NAMES the status it means.
		create: (_ctx: unknown, input: { id: string; label: string }) => ({
			status: input.id === "" ? 201 : 200,
			body: input,
		}),
		tagged: () => ({ status: 200, body: item, headers: { "x-correlation-id": "abc-123" } }),
		// A key the document does not declare, which the served body must not carry.
		plain: () => ({ status: 200, body: { id: "1", label: "plain", secret: "tenant-7" } }),
		throttle: (_ctx: unknown, input: { id: string }) => {
			switch (input.id) {
				case "slow":
					return { status: 429, body: { title: "slow down" }, headers: { "retry-after": 30 } };
				case "gone":
					return { status: 410, body: { title: "gone" } };
				case "down":
					return { status: 503, body: { reason: "maintenance" } };
				case "bad":
					// The right shape for a problem document, served on a status its schema forbids.
					return { status: 429, body: { title: 7 } };
				default:
					return { status: 200, body: item };
			}
		},
		text: () => ({ status: 200, body: "plain text" }),
		xml: () => ({ status: 200, body: "<item><id>1</id></item>" }),
		blob: () => ({ status: 200, body: new Blob([BYTES]).stream() }),
		either: (_ctx: unknown, _input: unknown) => ({
			status: 200,
			contentType: "application/xml",
			body: "<item/>",
		}),
		remove: (_ctx: unknown, input: { id: string }) =>
			// `remove` declares one response and no `default`. Only a value the type system cannot see
			// into returns anything else, which is why it throws rather than being served.
			input.id === "undeclared" ? { status: 500, body: item } : { status: 204 },
	};
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
	});
}, 600_000);

describe("the fixture compiles into what these arms read", () => {
	it("raises nothing but the one warning it is built to raise", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		expect(compiled.diagnostics.map((d) => d.code)).toEqual([
			"typespec-hono/unvalidated-response-media-type",
			"typespec-hono/unvalidated-response-media-type",
		]);
	});
});

describe("a handler names the status it answers with", () => {
	it("answers 201 when the handler returns 201", async () => {
		const response = await app.request("/items", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "", label: "new" }),
		});
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ id: "", label: "new" });
	});

	it("answers 200 when it returns 200, so the status is doing the work", async () => {
		const response = await app.request("/items", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "7", label: "existing" }),
		});
		expect(response.status).toBe(200);
	});
});

describe("a declared response header reaches the response", () => {
	it("sets it under its wire name", async () => {
		const response = await app.request("/items/1");
		expect(response.status).toBe(200);
		expect(response.headers.get("x-correlation-id")).toBe("abc-123");
	});
});

describe("a declared failure is returned and served, not thrown", () => {
	it("serves a status inside a range, as the problem document, with its header", async () => {
		const response = await app.request("/items/slow/throttle");
		expect(response.status).toBe(429);
		expect(response.headers.get("content-type")).toBe("application/problem+json");
		// Declared `int32`, supplied as a number, sent as text.
		expect(response.headers.get("retry-after")).toBe("30");
		expect(await response.json()).toEqual({ title: "slow down" });
	});

	it("omits an optional header the handler did not supply", async () => {
		const response = await app.request("/items/gone/throttle");
		expect(response.status).toBe(410);
		expect(response.headers.has("retry-after")).toBe(false);
	});

	/**
	 * `default` is every status not declared more precisely - which is why a status an operation with
	 * a `default` arm "does not declare" still has a body it must match, and is served, not refused.
	 */
	it("serves a status the default arm governs, with the default arm's body", async () => {
		const response = await app.request("/items/down/throttle");
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ reason: "maintenance" });
	});

	it("refuses a failure body its schema forbids, as a ResponseContractError for onError", async () => {
		const response = await app.request("/items/bad/throttle");
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "ResponseContractError" });
		expect(thrown.at(-1)).toMatchObject({ operationId: "throttle", status: 429 });
	});

	it("refuses a status the document does not declare, as an UndeclaredStatusError", async () => {
		const response = await app.request("/items/undeclared", { method: "DELETE" });
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "UndeclaredStatusError" });
	});
});

describe("what is served is the parsed body", () => {
	it("drops a key the document does not declare", async () => {
		/**
		 * **The projection seven of nine consumer surfaces relied on, each in its own `respond`.** A
		 * closed model's schema strips an undeclared key, and serving the parse result is what keeps an
		 * internal field off the wire.
		 */
		const response = await app.request("/items/plain");
		expect(response.status).toBe(200);
		// `label: "plain"` is what shows `plain` answered, rather than `tagged` on `/items/{id}`.
		expect(await response.json()).toEqual({ id: "1", label: "plain" });
	});
});

describe("a body that is not JSON is served as what the document says it is", () => {
	it("serves a string body as the text, under its media type", async () => {
		const response = await app.request("/text");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/plain");
		expect(await response.text()).toBe("plain text");
	});

	it("serves a model under XML as the text the handler supplied", async () => {
		const response = await app.request("/xml");
		expect(response.headers.get("content-type")).toBe("application/xml");
		expect(await response.text()).toBe("<item><id>1</id></item>");
	});

	it("streams raw bytes through unchanged", async () => {
		const response = await app.request("/blob");
		expect(response.headers.get("content-type")).toBe("application/octet-stream");
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...BYTES]);
	});

	it("serves the media type the handler names, where a status offers two", async () => {
		const response = await app.request("/either");
		expect(response.headers.get("content-type")).toBe("application/xml");
		expect(await response.text()).toBe("<item/>");
	});

	it("serves a bodyless response with no body", async () => {
		const response = await app.request("/items/1", { method: "DELETE" });
		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
	});
});
