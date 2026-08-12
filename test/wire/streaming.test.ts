import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **Can a generated server actually stream a response?**
 *
 * ⚠️ **The question is real because the generated signature returns a VALUE, not a `Response`.** An
 * operation is typed `Awaitable<Result<z.infer<typeof …Response>>>`, so a handler cannot hand back a
 * `ReadableStream` and call it a body. The library emits validators for SSE and JSON Lines payloads,
 * which makes it look as though streaming is supported; whether a server built on them can serve one
 * is a different question and had never been asked.
 *
 * The answer is that it can, through `deps.respond` — the hook that turns a result into a response —
 * and it needs no cast. That is worth pinning rather than trusting, because it is a consequence of
 * `respond` being allowed to return any `Response`, and a future signature that narrowed it to
 * "serialise this value as JSON" would remove streaming without failing anything else.
 *
 * ⚠️ **`Result<T>` is what carries the stream, and substituting it is the documented seam.** An app
 * pointing `runtime-module` at its own module re-declares `Result<T>` — that is the mechanism the
 * README already describes for envelopes, and streaming is the same mechanism. Nothing special is
 * needed here, which is the finding.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const referenceDir = join(here, "..", "reference");

let server: { registerRoutes: (a: unknown, h: unknown, d: unknown) => Hono };

beforeAll(async () => {
	const compiled = await compileFixture(referenceDir, "wire", { outName: "wire-streaming" });
	server = (await import(join(compiled.outDir, "app.gen.ts"))) as typeof server;
}, 600_000);

describe("an application can stream a response through the generated server", () => {
	it("serves Server-Sent Events, with the handler's value deciding the frames", async () => {
		const app = new Hono();
		const handlers = new Proxy({}, { get: () => (): unknown => ({ id: "1", label: "streamed" }) });
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
			/**
			 * ⚠️ **The whole finding is that this is allowed.** `respond` may return any `Response`, so an
			 * application streams by streaming here rather than by returning a stream from a handler.
			 */
			respond: (c: Parameters<typeof streamSSE>[0], _arms: unknown, value: unknown) =>
				streamSSE(c, async (stream) => {
					for (const part of ["first", "second"]) {
						await stream.writeSSE({ data: `${part}:${JSON.stringify(value)}` });
					}
				}),
		});

		const response = await routes.request("/items/7");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);

		const body = await response.text();
		// Both frames arrived, and each carries what the handler returned.
		expect(body).toMatch(/data: first:\{"id":"1","label":"streamed"\}/);
		expect(body).toMatch(/data: second:/);
	});

	it("still validates the request before any of it is streamed", async () => {
		/**
		 * ⚠️ **Streaming must not become a way around the contract.** The validators are middleware and
		 * run before the handler, so a request the document forbids is refused with a normal response and
		 * never reaches the stream — which is the property that would quietly break if `respond` were
		 * ever moved ahead of validation.
		 */
		const app = new Hono();
		const routes = server.registerRoutes(app, () => new Proxy({}, { get: () => () => ({}) }), {
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
			respond: (c: Parameters<typeof streamSSE>[0]) =>
				streamSSE(c, async (stream) => {
					await stream.writeSSE({ data: "should not be reached" });
				}),
		});

		// `itemId` is an integer; `abc` has no numeric reading.
		const response = await routes.request("/items/abc");
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).not.toMatch(/text\/event-stream/);
	});
});
