import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A request with no body, against an operation whose document says the body is optional.**
 *
 * `requestBody.required: false` means such a request is one the contract permits, and the generated
 * server refused it. Measured against @hono/zod-validator 0.9.0 and hono 4.12.26:
 *
 * | request | before |
 * | --- | --- |
 * | no body, no content-type | 200, validator saw `{}` |
 * | no body, `content-type: application/json` | **400 `Malformed JSON in request body`**, `text/plain` |
 * | `{}` | 200 |
 *
 * The middle row is two defects at once: a service refusing what its own document allows, and doing
 * it in a shape the document forbids - the 400 is raised inside `zValidator` before `deps.invalid`
 * is reached, so the app's error envelope never sees it.
 *
 * **Requests, not emitted text.** Asserting that `optionalBody(` appears would pass for a server
 * that still refuses every bodyless request.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let app: Hono;
const received: Record<string, unknown> = {};

beforeAll(async () => {
	const compiled = await compileFixture(here, "empty", { outName: "optional-requests" });
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
		/** The app's envelope. Anything that answers 400 without passing through here has escaped it. */
		invalid: (
			result: { success: boolean },
			c: { json: (b: unknown, s: number) => Response },
		): Response | undefined => (result.success ? undefined : c.json({ envelope: true }, 400)),
		respond: (c: { body: (b: null, s: number) => Response }) => c.body(null, 204),
	});
}, 600_000);

describe("an optional body may simply be absent", () => {
	it("accepts a request with no body at all", async () => {
		const response = await app.request("/things/1/optional", { method: "POST" });
		expect(response.status).toBe(204);
	});

	it("accepts a bodyless request that names the content type, which used to 400", async () => {
		const response = await app.request("/things/1/optional", {
			method: "POST",
			headers: { "content-type": "application/json" },
		});
		expect(response.status).toBe(204);
	});

	it("tells the handler the body is absent rather than inventing an empty one", async () => {
		await app.request("/things/1/optional", { method: "POST" });
		const input = received["optional"] as { id: string; body?: unknown };
		expect(input.id).toBe("1");
		// The reason an optional body is NAMED: a merge could only have said the properties were
		// present, and they are not.
		expect(input.body).toBeUndefined();
	});

	it("still validates a body that IS sent", async () => {
		await app.request("/things/1/optional", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ note: "hello" }),
		});
		expect((received["optional"] as { body?: { note: string } }).body).toEqual({ note: "hello" });
	});

	it("refuses a body that is sent and wrong, through the app's own envelope", async () => {
		const response = await app.request("/things/1/optional", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ note: 42 }),
		});
		expect(response.status).toBe(400);
		// The envelope, not `zValidator`'s text/plain default.
		expect(await response.json()).toEqual({ envelope: true });
	});

	it("refuses a malformed body through the same envelope", async () => {
		const response = await app.request("/things/1/optional", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ envelope: true });
	});
});
