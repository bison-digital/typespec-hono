import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A JSON body carrying `__proto__`, or `constructor.prototype`, is refused at the parser.**
 *
 * See `protopoison.tsp`. Zod strips a `__proto__` key without reading it, so `Record<boolean>`
 * accepted `{"__proto__": 1}`, which the document refuses. Validating the key would mean working
 * around Zod's own guard; the ecosystem's answer sits one layer earlier. Fastify's
 * `onProtoPoisoning`/`onConstructorPoisoning` and hapi's `payload.protoAction` all default to
 * `'error'`, through `secure-json-parse` (forked from hapi's `bourne`), which this server now parses
 * JSON with at those defaults. Refusing `{"__proto__": true}`, which the document would accept, is
 * the same trade those servers make.
 *
 * **Requests, not emitted text**, as in `test/malformed`: every arm sends one and reads the answer.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let app: Hono;
const received: Record<string, unknown> = {};

beforeAll(async () => {
	const compiled = await compileFixture(here, "protopoison", { outName: "protopoison" });
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
		/** The app's envelope: a refusal that does not pass through here has escaped it. */
		invalid: (
			result: { success: boolean },
			c: { json: (b: unknown, s: number) => Response },
		): Response | undefined => (result.success ? undefined : c.json({ envelope: true }, 400)),
	});
}, 600_000);

/** POSTs `text` as JSON, verbatim: `JSON.stringify` cannot spell an own `__proto__` key. */
function post(path: string, text: string): Promise<Response> {
	return Promise.resolve(
		app.request(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: text,
		}),
	);
}

describe("a JSON body naming the prototype is refused through the app's envelope", () => {
	it.each([
		["the value the record refuses", "/flags", '{"__proto__": 1}'],
		["a value the record would accept", "/flags", '{"ok": true, "__proto__": true}'],
		["the key spelled with a unicode escape", "/flags", '{"\\u005f_proto__": 1}'],
		["the key one level down", "/holder", '{"inner": {"__proto__": "x"}}'],
		["constructor.prototype", "/bag", '{"constructor": {"prototype": {}}}'],
	])("refuses %s", async (_label, path, text) => {
		delete received["flags"];
		delete received["holder"];
		delete received["bag"];
		const response = await post(path, text);
		expect(response.status).toBe(400);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ envelope: true });
		// Refused before the handler, not read and then answered.
		expect(received).not.toHaveProperty(path.slice(1));
	});
});

/**
 * **Non-vacuity.** The arms above pass for a server that refuses every body. These are bodies a
 * prototype guard must leave alone: the near misses its text pre-check matches and its scan clears.
 */
describe("a body that only resembles one is served", () => {
	it.each([
		["an ordinary record", "/flags", '{"ok": true}', { body: { ok: true } }],
		[
			"a key named constructor",
			"/flags",
			'{"constructor": false}',
			{ body: { constructor: false } },
		],
		[
			"the key's text inside a string value",
			"/holder",
			'{"inner": {"a": "\\"__proto__\\": 1"}}',
			{ inner: { a: '"__proto__": 1' } },
		],
		/**
		 * `secure-json-parse` 4.0.0 read `.prototype` off a `null` constructor and threw, which this
		 * reader turns into a refusal; 4.1.1 fixed it, and is why the peer floor is `^4.1.1`.
		 */
		["constructor null", "/maybe", '{"constructor": null}', { body: { constructor: null } }],
	])("serves %s", async (_label, path, text, input) => {
		const response = await post(path, text);
		expect(response.status).toBe(204);
		expect(received[path.slice(1)]).toEqual(input);
	});
});
