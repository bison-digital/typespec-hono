import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
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
let download: unknown = PNG;
/** Not UTF-8: decoded as text, the first and last bytes come back as U+FFFD. */
const BLOB = new Uint8Array([0xff, 0x00, 0x80, 0xfe]);

async function bytesOf(value: unknown): Promise<number[]> {
	return [...new Uint8Array(await new Response(value as ReadableStream).arrayBuffer())];
}

/** `tsc` over one hand-written file beside the generated server; its output, empty when clean. */
function typecheck(source: string): string {
	const consumer = join(compiled.outDir, "consumer.ts");
	const config = join(compiled.outDir, "tsconfig.consumer.json");
	writeFileSync(consumer, source);
	writeFileSync(
		config,
		JSON.stringify({
			compilerOptions: {
				target: "es2023",
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				exactOptionalPropertyTypes: true,
				noEmit: true,
				skipLibCheck: true,
			},
			include: ["./*.ts"],
		}),
	);
	try {
		execFileSync(join(here, "..", "..", "node_modules", ".bin", "tsc"), ["-p", config], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return "";
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
	} finally {
		rmSync(consumer, { force: true });
	}
}

beforeAll(async () => {
	compiled = await compileFixture(here, "raw", { outName: "rawbodies" });
	const { registerRoutes } = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: Hono, handlersFor: unknown, deps: unknown) => Hono;
	};
	const record = (name: string) => async (_ctx: unknown, input: Record<string, unknown>) => {
		const copy: Record<string, unknown> = { ...input };
		if (input["file"] instanceof ReadableStream) copy["file"] = await bytesOf(input["file"]);
		if (input["body"] instanceof ReadableStream) copy["body"] = await bytesOf(input["body"]);
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
			putAtom: record("putAtom"),
			putBlob: record("putBlob"),
			getBlob: () => ({ status: 200, body: BLOB }),
			downloadImage: () => ({ status: 200, body: download }),
			downloadJsonFile: () => ({ status: 200, body: new TextEncoder().encode('{"a":1}') }),
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

	/**
	 * **A body handed over unchecked is said to be.** The model under XML reaches its handler as the
	 * text that arrived and nothing checks it, which the response side has always said of a model it
	 * serves as XML. A file and a bytes body declare nothing to check, so neither is named.
	 */
	it("warns that each model under a media type nothing parses is handed over unvalidated, and nothing else", () => {
		const warned = compiled.diagnostics
			.filter((d) => d.code === "typespec-hono/unvalidated-request-media-type")
			.map((d) => /'([^']+)'/.exec(d.message)?.[1]);
		expect(warned).toEqual(["putXml", "putAtom", "putBlob"]);
		const served = compiled.diagnostics
			.filter((d) => d.code === "typespec-hono/unvalidated-response-media-type")
			.map((d) => /'([^']+)'/.exec(d.message)?.[1]);
		expect(served).toEqual(["getBlob"]);
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

	it("is text under an XML suffix too", async () => {
		const atom = "<feed/>";
		const response = await app.request("/atom", {
			method: "PUT",
			headers: { "content-type": "application/atom+xml" },
			body: atom,
		});
		expect(response.status).toBe(204);
		expect(received["putAtom"]?.["body"]).toBe(atom);
	});

	it("reaches the handler as the exact bytes sent where the media type is not text", async () => {
		const response = await app.request("/blob", {
			method: "PUT",
			headers: { "content-type": "application/octet-stream" },
			body: BLOB,
		});
		expect(response.status).toBe(204);
		expect(received["putBlob"]?.["body"]).toEqual([...BLOB]);
	});

	it("is answered as bytes where the media type is not text, which a string cannot carry", () => {
		expect(
			typecheck(`import type { Operations } from "./app.gen.js";
export const handler: Operations["getBlob"] = () => ({ status: 200, body: new Uint8Array([0xff]) });
`),
		).toBe("");
	});

	it("is served as the exact bytes the handler answers where the media type is not text", async () => {
		const response = await app.request("/blob/latest");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/octet-stream");
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...BLOB]);
	});
});

describe("an Http.File download", () => {
	/**
	 * **A file declared as JSON is served under JSON too.** The serving rule left `Content-Type` to
	 * `c.json` wherever the type was `application/json`, but a file is bytes and is served with
	 * `c.body`, which sets none: the response went out with no media type at all.
	 */
	it("is served under its media type when that type is JSON", async () => {
		const response = await app.request("/json-file/latest");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(await response.text()).toBe('{"a":1}');
	});

	it("is served as the bytes, under its media type", async () => {
		download = PNG;
		const response = await app.request("/files/latest");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...PNG]);
	});
});

/**
 * **A stream a backend returns typed by the contract is served, and still streams.** The contract
 * states a binary body as `ByteStream`, the reader every stream has, because it cannot name the
 * platform stream; a value that is only that reader was refused by the handler's type, and
 * `new Response(value)` would have served `[object Object]`.
 */
describe("a binary body that is only a ByteStream", () => {
	it("compiles as a handler's result", () => {
		expect(
			typecheck(`import type { Operations } from "./app.gen.js";
declare const reader: { getReader(): { read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>; releaseLock(): void } };
export const handler: Operations["downloadImage"] = () => ({ status: 200, body: reader });
`),
		).toBe("");
	});

	it("is served as its exact bytes, the first chunk before the producer has the last", async () => {
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let reads = 0;
		download = {
			getReader: () => ({
				async read() {
					reads++;
					if (reads === 1) return { done: false, value: PNG.slice(0, 4) };
					if (reads === 2) {
						await gate;
						return { done: false, value: PNG.slice(4) };
					}
					return { done: true };
				},
				releaseLock: () => undefined,
			}),
		};
		const response = await app.request("/files/latest");
		expect(response.status).toBe(200);
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		const timeout = new Promise<"materialised">((resolve) =>
			setTimeout(() => resolve("materialised"), 2000),
		);
		const first = await Promise.race([reader.read(), timeout]);
		expect(first, "the first chunk did not arrive before the last was produced").not.toBe(
			"materialised",
		);
		release();
		const chunks = [...((first as { value: Uint8Array }).value ?? [])];
		for (let next = await reader.read(); !next.done; next = await reader.read())
			chunks.push(...next.value);
		expect(chunks).toEqual([...PNG]);
	});

	/**
	 * **A read may report no chunk and not be done, and the stream goes on.** `ByteStream` admits it,
	 * and the served stream asked for nothing more after one, so a server reading the body as a
	 * `Response` - which is how a Node adapter writes it - held the response open forever. Hono's
	 * in-memory `app.request` happens to ask again, so this reads the emitted `servedBytes` the way a
	 * server does.
	 */
	it("serves past a read that carries no chunk", async () => {
		const { servedBytes } = (await import(join(compiled.outDir, "runtime.gen.ts"))) as {
			servedBytes: (body: unknown) => ConstructorParameters<typeof Response>[0];
		};
		const reads = [{ done: false }, { done: false, value: PNG.slice(0, 3) }, { done: true }];
		const source = {
			getReader: () => ({
				read: async () => reads.shift() ?? { done: true },
				releaseLock: () => undefined,
			}),
		};
		const served = await Promise.race([
			new Response(servedBytes(source)).arrayBuffer(),
			new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 2000)),
		]);
		expect(served, "the stream stopped after a read with no chunk").not.toBe("hung");
		expect(Array.from(new Uint8Array(served as ArrayBuffer))).toEqual(Array.from(PNG.slice(0, 3)));
	});

	/**
	 * **A caller that goes away cancels the producer.** The response stream released the source's
	 * reader and never cancelled it, so a producer behind a reader-only stream - an SSE feed, a
	 * service binding's body - kept producing for nobody.
	 */
	it("cancels the source when the response is cancelled", async () => {
		let cancelled: unknown = "not cancelled";
		download = {
			getReader: () => ({
				read: async () => ({ done: false, value: PNG.slice(0, 1) }),
				releaseLock: () => undefined,
				cancel: async (reason?: unknown) => {
					cancelled = reason;
				},
			}),
		};
		const response = await app.request("/files/latest");
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		await reader.read();
		await reader.cancel("the caller left");
		expect(cancelled).toBe("the caller left");
	});
});
