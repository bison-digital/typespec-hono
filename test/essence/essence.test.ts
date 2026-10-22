import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/** **A declared media type is compared by its essence, by the server too.** See `essence.tsp`. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;
let app: Hono;

beforeAll(async () => {
	compiled = await compileFixture(here, "essence", { outName: "essence" });
	const { registerRoutes } = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: Hono, handlersFor: unknown, deps: unknown) => Hono;
	};
	app = new Hono();
	registerRoutes(
		app,
		() => ({
			withCharset: (_ctx: unknown, input: { id: string }) => ({
				status: 200,
				body: { id: input.id },
			}),
			asJson: () => ({ status: 200, body: { id: "json" } }),
			asText: () => ({ status: 200, body: "text" }),
		}),
		{
			authorize: () => async (_c: unknown, next: () => Promise<void>) => {
				await next();
			},
			context: () => ({}),
			noContext: () => new Response(null, { status: 401 }),
			notAcceptable: () => new Response(null, { status: 406 }),
			invalid: (result: { success: boolean }) =>
				result.success ? undefined : new Response(null, { status: 400 }),
		},
	);
}, 300_000);

const post = (contentType: string) =>
	app.request("/charset", {
		method: "POST",
		headers: { "content-type": contentType },
		body: JSON.stringify({ id: "a" }),
	});

describe("a body declared as application/json; charset=utf-8", () => {
	it("compiles with no error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("is accepted under any spelling of that media type", async () => {
		for (const sent of [
			"application/json; charset=utf-8",
			"application/json",
			"Application/JSON",
		]) {
			const response = await post(sent);
			expect(response.status, sent).toBe(200);
			expect(await response.json(), sent).toEqual({ id: "a" });
		}
	});

	it("is refused under another media type", async () => {
		expect((await post("text/plain")).status).toBe(400);
	});

	it("is answered under the media type the document declares", async () => {
		const response = await post("application/json");
		expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
	});
});

describe("negotiation between operations, one offering a parametered media type", () => {
	it("chooses it for a caller accepting that type", async () => {
		const response = await app.request("/negotiated", { headers: { accept: "application/json" } });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: "json" });
	});

	it("still chooses the other for a caller accepting only that", async () => {
		const response = await app.request("/negotiated", { headers: { accept: "text/plain" } });
		expect(await response.text()).toBe("text");
	});
});
