import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A multipart part read from text is read from its text, whether or not it came with a filename.**
 * `parseBody` hands a part sent with one over as a file - `curl -F 'r=@data.json;type=application/json'`
 * - and the part's schema, reading text, refused it, though its media type says what it is. A file
 * part and raw bytes stay files. A JSON part naming the object prototype is refused through the app's
 * envelope, as a JSON body is: its JSON is parsed by the part's schema, which `secure-json-parse`
 * never saw, so `{"__proto__": 1}` reached a `Record<boolean>` part with the key dropped.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let app: Hono;
let received: unknown;

beforeAll(async () => {
	const compiled = await compileFixture(here, "textparts", { outName: "textparts" });
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	app = new Hono();
	// A required multipart body is merged into the input, beside its content type.
	const handlers = {
		f: (_ctx: unknown, input: unknown): unknown => {
			received = input;
			return { status: 204 };
		},
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
		): Response | undefined => (result.success ? undefined : c.json({ envelope: true }, 400)),
	});
}, 600_000);

/** A part as a file, with a filename and a media type, or as text where `type` is absent. */
type Part = readonly [name: string, text: string, type?: string];

async function send(parts: readonly Part[]): Promise<{ status: number; body: unknown }> {
	const form = new FormData();
	for (const [name, text, type] of parts) {
		if (type === undefined) form.append(name, text);
		else form.append(name, new Blob([text], { type }), `${name}.data`);
	}
	received = undefined;
	const response = await app.request("/f", { method: "POST", body: form });
	return {
		status: response.status,
		body: response.status === 204 ? received : await response.json(),
	};
}

describe("a part read from text, sent with a filename", () => {
	it.each([
		["JSON", [["json", '{"city":"x"}', "application/json"]], { json: { city: "x" } }],
		["a JSON list", [["list", "[1,2]", "application/json"]], { list: [1, 2] }],
		["text", [["text", "hello", "text/plain"]], { text: "hello" }],
		["a number", [["number", "5", "text/plain"]], { number: 5 }],
		[
			"text or JSON, as JSON",
			[["either", '{"city":"x"}', "application/json"]],
			{ either: { city: "x" } },
		],
		[
			"a repeated JSON part, once per file",
			[
				["repeated", '{"city":"x"}', "application/json"],
				["repeated", '{"city":"y"}', "application/json"],
			],
			{ repeated: [{ city: "x" }, { city: "y" }] },
		],
	] as const)("reads %s as its text", async (_label, parts, body) => {
		expect(await send(parts)).toEqual({
			status: 204,
			body: { "Content-Type": "multipart/form-data", ...body },
		});
	});

	it("reads it as before without one", async () => {
		expect(
			await send([
				["json", '{"city":"x"}'],
				["number", "5"],
			]),
		).toEqual({
			status: 204,
			body: { "Content-Type": "multipart/form-data", json: { city: "x" }, number: 5 },
		});
	});

	it("still refuses text that is not the part's value", async () => {
		expect(await send([["json", "{", "application/json"]])).toEqual({
			status: 400,
			body: { envelope: true },
		});
		expect(await send([["number", "x", "text/plain"]])).toEqual({
			status: 400,
			body: { envelope: true },
		});
	});
});

describe("a file part and raw bytes", () => {
	it("are handed over as the files they arrive as", async () => {
		const { status } = await send([
			["file", "a", "image/png"],
			["raw", "b", "application/octet-stream"],
		]);
		expect(status).toBe(204);
		const body = received as { file?: unknown; raw?: unknown };
		expect(body.file).toBeInstanceOf(File);
		expect(body.raw).toBeInstanceOf(File);
	});
});

describe("a JSON part naming the object prototype", () => {
	it.each([
		["sent as text", [["flags", '{"__proto__": 1}']]],
		["sent as a file", [["flags", '{"__proto__": 1}', "application/json"]]],
		["the key one level down", [["nested", '{"a": {"__proto__": 1}}']]],
		["constructor.prototype", [["bag", '{"constructor": {"prototype": {}}}']]],
		[
			"in one of a repeated part's parts",
			[
				["repeatedFlags", '{"ok": true}'],
				["repeatedFlags", '{"__proto__": 1}'],
			],
		],
	] as const)("is refused through the app's envelope, %s", async (_label, parts) => {
		expect(await send(parts)).toEqual({ status: 400, body: { envelope: true } });
		expect(received).toBeUndefined();
	});

	it("is served where it only resembles one, or is text a part may be", async () => {
		expect(await send([["flags", '{"constructor": false}']])).toEqual({
			status: 204,
			body: { "Content-Type": "multipart/form-data", flags: { constructor: false } },
		});
		expect(await send([["either", '{"__proto__": 1}']])).toEqual({
			status: 204,
			body: { "Content-Type": "multipart/form-data", either: '{"__proto__": 1}' },
		});
	});
});
