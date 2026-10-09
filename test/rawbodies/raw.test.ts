import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/** **What a raw body reaches the handler as, by real request.** See `raw.tsp`. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let app: Hono;
const received: Record<string, Record<string, unknown>> = {};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8]);

async function bytesOf(value: unknown): Promise<number[]> {
	return [...new Uint8Array(await new Response(value as ReadableStream).arrayBuffer())];
}

beforeAll(async () => {
	compiled = await compileFixture(here, "raw", { outName: "rawbodies" });
	const { registerRoutes } = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: Hono, handlersFor: unknown, deps: unknown) => Hono;
	};
	const record = (name: string) => async (_ctx: unknown, input: Record<string, unknown>) => {
		const copy: Record<string, unknown> = { ...input };
		if (input["file"] instanceof ReadableStream) copy["file"] = await bytesOf(input["file"]);
		received[name] = copy;
		return { status: 204 };
	};
	app = new Hono();
	registerRoutes(
		app,
		() => ({
			uploadImage: record("uploadImage"),
			uploadJsonFile: record("uploadJsonFile"),
			putXml: record("putXml"),
			downloadImage: () => ({ status: 200, body: PNG }),
		}),
		{
			authorize: () => async (_c: unknown, next: () => Promise<void>) => {
				await next();
			},
			context: () => ({}),
			noContext: () => new Response(null, { status: 401 }),
			notAcceptable: () => new Response(null, { status: 406 }),
			invalid: () => undefined,
		},
	);
}, 300_000);

describe("an Http.File upload", () => {
	it("compiles with no error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("reaches the handler as the bytes sent, with the media type it was sent as", async () => {
		const response = await app.request("/files", {
			method: "POST",
			headers: { "content-type": "image/jpeg" },
			body: PNG,
		});
		expect(response.status).toBe(204);
		expect(received["uploadImage"]?.["file"]).toEqual([...PNG]);
		expect(received["uploadImage"]?.["Content-Type"]).toBe("image/jpeg");
	});

	it("is bytes when declared application/json too, not text", async () => {
		const sent = new TextEncoder().encode('{"a":1}');
		const response = await app.request("/json-file", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: sent,
		});
		expect(response.status).toBe(204);
		expect(received["uploadJsonFile"]?.["file"]).toEqual([...sent]);
	});
});

describe("a model under a media type nothing parses", () => {
	it("reaches the handler as the text that arrived", async () => {
		const xml = "<Thing><id>t1</id></Thing>";
		const response = await app.request("/xml", {
			method: "PUT",
			headers: { "content-type": "application/xml" },
			body: xml,
		});
		expect(response.status).toBe(204);
		expect(received["putXml"]?.["body"]).toBe(xml);
	});
});

describe("an Http.File download", () => {
	it("is served as the bytes, under its media type", async () => {
		const response = await app.request("/files/latest");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...PNG]);
	});
});
