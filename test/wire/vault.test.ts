import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A hierarchical identifier arrives whole, which a comparison against the document cannot show.**
 *
 * The document deliberately DISAGREES here: OpenAPI cannot express RFC 6570 reserved expansion at any
 * version including 3.2, so it publishes `/vault/{path}` while the server mounts `:path{.+}`. There is
 * therefore nothing to differentiate against, and only a request settles whether the feature works.
 *
 * **The divergence is a superset, not a contradiction, and that is asserted below.** A client
 * generated from the document percent-encodes a path parameter, so it sends
 * `/vault/areas%2Fhealth.md`. A greedy route answers that too, and yields the same value. If it did
 * not, the licensed divergence would be a broken contract rather than a wider one.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const referenceDir = join(here, "..", "reference");

let app: Hono;
const received: Record<string, unknown> = {};

beforeAll(async () => {
	const compiled = await compileFixture(referenceDir, "vault", { outName: "vault-requests" });
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	app = new Hono();
	const handlers = new Proxy(
		{},
		{
			get:
				(_t, name: string) =>
				(_ctx: unknown, input: unknown): unknown => {
					received[name] = input;
					return { path: "p", body: "b" };
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
		invalid: (r: { success: boolean }, c: { json: (b: unknown, s: number) => Response }) =>
			r.success ? undefined : c.json(r, 400),
		respond: (c: { json: (b: unknown) => Response }, _a: unknown, v: unknown) => c.json(v),
	});
}, 600_000);

describe("a path parameter declared with reserved expansion", () => {
	it("delivers a multi-segment value whole", async () => {
		const response = await app.request("/vault/areas/health.md");
		expect(response.status).toBe(200);
		// The whole point: `areas` alone would mean the router stopped at the first slash.
		expect(received["readNote"]).toMatchObject({ path: "areas/health.md" });
	});

	it("still serves a single-segment value", async () => {
		const response = await app.request("/vault/inbox.md");
		expect(response.status).toBe(200);
		expect(received["readNote"]).toMatchObject({ path: "inbox.md" });
	});

	it("answers the percent-encoded form a generated client would send", async () => {
		const response = await app.request("/vault/areas%2Fhealth.md");
		expect(response.status).toBe(200);
		expect(received["readNote"]).toMatchObject({ path: "areas/health.md" });
	});

	it("matches when a literal segment follows the greedy parameter", async () => {
		const response = await app.request("/vault/areas/health.md/move", { method: "POST" });
		expect(response.status).toBe(200);
		expect(received["moveNote"]).toMatchObject({ path: "areas/health.md" });
	});

	it("uses the WIRE name when the parameter is renamed", async () => {
		const response = await app.request("/file/areas/health.md");
		expect(response.status).toBe(200);
		expect(received["readFile"]).toMatchObject({ "note-path": "areas/health.md" });
	});

	it("applies greedily to the declared parameter only, not to its neighbour", async () => {
		const response = await app.request("/repo/acme/heads/main");
		expect(response.status).toBe(200);
		expect(received["readRef"]).toMatchObject({ owner: "acme", ref: "heads/main" });
	});

	it("leaves an ordinary parameter ordinary, so nothing was loosened", async () => {
		// A slash here must NOT match: the document says one segment and the server must agree.
		expect((await app.request("/notes/a/b")).status).toBe(404);
		expect((await app.request("/notes/abc")).status).toBe(200);
	});

	it("emits the greedy form for exactly the parameters the document marks", () => {
		const source = readFileSync(join(referenceDir, ".out", "vault-requests", "app.gen.ts"), "utf8");
		const greedy = [...source.matchAll(/"([^"]*\{\.\+\}[^"]*)"/g)].map((m) => m[1]);
		// Non-vacuity: four declared reserved parameters, and the control must not be among them.
		expect(greedy.length).toBeGreaterThanOrEqual(4);
		expect(source).toContain('"/notes/:id"');
		expect(source).not.toContain(":id{.+}");
	});
});
