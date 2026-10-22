import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A streamed response is a declared response like any other.**
 *
 * An SSE or JSON Lines operation publishes its body as a string, the stream itself, and the library
 * marks the arm `streamed`. So the generated result type takes a `ReadableStream` for that body and
 * the route hands it to `c.body` unread: the handler streams by returning a stream, and nothing about
 * the response has to be rebuilt by hand.
 *
 * **This used to be possible only through `deps.respond`**, which could return any `Response`, while
 * the handler's own type was a JSON value. Streaming worked because the hook was permissive, which is
 * exactly the kind of property a later narrowing removes without failing anything. It is now the
 * operation's declared type.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let server: { registerRoutes: (a: unknown, h: unknown, d: unknown) => Hono };

const deps = {
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
};

/** A stream of text frames, as a handler piping events from somewhere would produce. */
function framesOf(frames: readonly string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const frame of frames) controller.enqueue(encoder.encode(frame));
			controller.close();
		},
	});
}

beforeAll(async () => {
	const compiled = await compileFixture(here, "feed", { outName: "feed-streaming" });
	server = (await import(join(compiled.outDir, "app.gen.ts"))) as typeof server;
}, 600_000);

describe("a handler streams a response by returning a stream", () => {
	it("serves Server-Sent Events under the declared media type, frame by frame", async () => {
		let reached = 0;
		const routes = server.registerRoutes(
			new Hono(),
			() => ({
				feed: (_ctx: unknown, input: { channel: number }) => {
					reached++;
					return {
						status: 200,
						body: framesOf([`data: {"channel":${input.channel}}\n\n`, "data: second\n\n"]),
					};
				},
				lines: () => ({ status: 200, body: framesOf([]) }),
			}),
			deps,
		);
		const response = await routes.request("/feed/7");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
		const body = await response.text();
		// Both frames arrived, and the first carries the decoded path parameter.
		expect(body).toBe('data: {"channel":7}\n\ndata: second\n\n');
		expect(reached).toBe(1);
	});

	it("serves JSON Lines the same way", async () => {
		const routes = server.registerRoutes(
			new Hono(),
			() => ({
				feed: () => ({ status: 200, body: framesOf([]) }),
				lines: () => ({ status: 200, body: framesOf(['{"at":"a","value":1}\n']) }),
			}),
			deps,
		);
		const response = await routes.request("/lines");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toMatch(/application\/jsonl/);
		expect(await response.text()).toBe('{"at":"a","value":1}\n');
	});

	it("still validates the request before any of it is streamed", async () => {
		/**
		 * **Streaming must not become a way around the contract.** The validators are middleware and
		 * run before the handler, so a request the document forbids is refused with a normal response
		 * and the handler that would open the stream is never called.
		 */
		let reached = 0;
		const routes = server.registerRoutes(
			new Hono(),
			() => ({
				feed: () => {
					reached++;
					return { status: 200, body: framesOf(["data: should not be reached\n\n"]) };
				},
				lines: () => ({ status: 200, body: framesOf([]) }),
			}),
			deps,
		);
		// `channel` is an integer; `abc` has no numeric reading.
		const response = await routes.request("/feed/abc");
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).not.toMatch(/text\/event-stream/);
		expect(reached).toBe(0);
	});
});
