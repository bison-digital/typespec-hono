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
			downloadImage: () => ({ status: 200, body: download }),
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
	it("compiles as a handler's result", async () => {
		const { execFileSync } = await import("node:child_process");
		const { rmSync, writeFileSync } = await import("node:fs");
		const consumer = join(compiled.outDir, "consumer.ts");
		const config = join(compiled.outDir, "tsconfig.consumer.json");
		writeFileSync(
			consumer,
			`import type { Operations } from "./app.gen.js";
declare const reader: { getReader(): { read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>; releaseLock(): void } };
export const handler: Operations["downloadImage"] = () => ({ status: 200, body: reader });
`,
		);
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
		let output = "";
		try {
			execFileSync(join(here, "..", "..", "node_modules", ".bin", "tsc"), ["-p", config], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			const asExec = error as { stdout?: string; stderr?: string };
			output = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
		} finally {
			rmSync(consumer, { force: true });
		}
		expect(output).toBe("");
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
