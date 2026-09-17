import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **`safeParse` not throwing is the contract this emitter's whole request path rests on.**
 *
 * Zod recurses once per level of a recursive model and has no depth guard, so a deep enough body
 * meets a `RangeError` - which is not a validation failure and does not stop at `safeParse`. It
 * escaped to `app.onError`, where an application cannot tell it from a bug in its own code, and the
 * caller got a 500.
 *
 * **The body that produced it is one the document calls VALID.** Measured on a generated server under
 * `workerd`: 40.5 KB, about 1,925 levels, answered `500 {"kind":"RangeError"}` while Ajv 2020-12 on
 * the published document accepted the same value. A payload the contract permits must never be a 500.
 *
 * It cannot be served either - the runtime genuinely cannot parse it - so it is refused, through
 * `deps.invalid` like every other bad request, carrying an issue that says which limit was met.
 *
 * **The threshold is a property of the runtime, not of this package**, so no arm pins a number. What
 * is asserted is the shape of both answers: an ordinary depth is served, and a depth past the limit
 * is refused rather than thrown.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let app: Hono;
const refusals: { success: boolean; error?: { issues?: { message?: string }[] } }[] = [];
let threw: unknown;

/** A body `n` levels deep, built as text so constructing the probe cannot overflow first. */
const nested = (n: number): string =>
	`${'{"name":"x","child":'.repeat(n)}{"name":"x"}${"}".repeat(n)}`;

beforeAll(async () => {
	const compiled = await compileFixture(here, "deep");
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	app = new Hono();
	app.onError((error) => {
		threw = error;
		throw error;
	});
	const handlers = new Proxy(
		{},
		{ get: () => (): unknown => ({ status: 200, body: { ok: true } }) },
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
		): Response | undefined => {
			if (result.success) return undefined;
			refusals.push(result);
			return c.json({ envelope: true }, 400);
		},
	});
}, 600_000);

const post = async (depth: number): Promise<Response> =>
	app.request("/deep", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: nested(depth),
	});

describe("a body too deep for the runtime to parse is refused, not thrown", () => {
	it("serves an ordinary depth, so the refusal below is not simply a broken route", async () => {
		const response = await post(50);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("refuses a body past the runtime's limit through the app's envelope", async () => {
		threw = undefined;
		refusals.length = 0;
		/**
		 * Deep enough to be past any plausible stack. The arm is about which ANSWER the caller gets,
		 * not about where the boundary sits, so it does not bisect for it.
		 */
		const response = await post(20_000);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ envelope: true });
	});

	it("does not reach app.onError, where it is indistinguishable from a bug", async () => {
		// The defect this fixture exists for: a `RangeError` arriving as the application's own fault.
		expect(threw).toBeUndefined();
	});

	it("says which limit was met, rather than failing the schema generically", async () => {
		const issues = refusals.at(-1)?.error?.issues ?? [];
		expect(issues.map((issue) => issue.message)).toEqual([
			"input is nested too deeply for this runtime to validate",
		]);
	});
});
