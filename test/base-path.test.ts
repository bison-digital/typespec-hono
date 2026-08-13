import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { compileFixture } from "./support/compile-fixture.js";

/**
 * **The server serves the URLs the document publishes.**
 *
 * ⚠️ **An OpenAPI path is relative to its server.** `@server("/api/v1")` plus a path of `/things`
 * means the document publishes `/api/v1/things` — so a server mounting `/things` disagrees with the
 * document generated from the same spec, which is the one thing this project exists to prevent.
 * Measured before this existed: every client generated from the document, and every "try it" in a
 * rendered document, answered 404.
 *
 * ⚠️ **This file exists because the branch was written and graded by NOTHING.** Deleting base-path
 * resolution from `src/` entirely left all 122 tests green. Every other fixture in this suite either
 * declares no `@server` or a templated one, and `@typespec/http-specs` is almost entirely
 * `@server("{endpoint}")` — so the static case, which is what a real product declares, had no
 * fixture at all. A control that passes is the finding.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const referenceDir = join(here, "reference");

/** Mount the emitted server and ask Hono itself what it will dispatch to. */
async function mountedPaths(outDir: string): Promise<string[]> {
	const server = (await import(join(outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => Hono;
	};
	const noop = (): undefined => undefined;
	const app = server.registerRoutes(
		new Hono(),
		() => new Proxy({}, { get: () => noop }),
		new Proxy({}, { get: () => noop }),
	);
	return [...new Set(app.routes.filter((r) => r.method !== "ALL").map((r) => r.path))].toSorted();
}

describe("a service declaring a base path is served under it", () => {
	it("mounts every route under the document's server path", async () => {
		const compiled = await compileFixture(referenceDir, "based", { outName: "based" });
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

		/**
		 * ⚠️ **Asked of `app.routes` rather than read out of the emitted text.** A prefix that appears in
		 * the source but does not reach the router is exactly the class of defect this suite has been
		 * bitten by — fifteen HEAD routes were "mounted" by every text-reading arm and dispatched to by
		 * nothing.
		 */
		const paths = await mountedPaths(compiled.outDir);
		expect(paths).toEqual(["/api/v1/things", "/api/v1/things/:id"]);
		// And nothing is left at the unprefixed path, which would answer the wrong URL.
		expect(paths.some((path) => path === "/things")).toBe(false);
	}, 300_000);

	it("answers the URL the document publishes, and only that one", async () => {
		const compiled = await compileFixture(referenceDir, "based", { outName: "based-requests" });
		const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
			registerRoutes: (a: unknown, h: unknown, d: unknown) => Hono;
		};
		const app = server.registerRoutes(
			new Hono(),
			() => new Proxy({}, { get: () => () => [{ id: "1" }] }),
			{
				authorize: () => async (_c: unknown, next: () => Promise<void>) => {
					await next();
				},
				context: () => ({}),
				noContext: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 401),
				notAcceptable: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 406),
				invalid: (
					r: { success: boolean },
					c: { json: (b: unknown, s: number) => Response },
				): Response | undefined => (r.success ? undefined : c.json(r, 400)),
				respond: (c: { json: (b: unknown) => Response }, _a: unknown, v: unknown) => c.json(v),
			},
		);
		expect((await app.request("/api/v1/things")).status).toBe(200);
		expect((await app.request("/things")).status).toBe(404);
	}, 300_000);

	it("reports rather than guesses when the declared servers disagree", async () => {
		/**
		 * ⚠️ **Mounted at the root, and SAID so.** There is no prefix that serves both `/api/v1` and
		 * `/api/v2`; choosing one would serve the wrong URL for the other, and a route under a wrong
		 * prefix still matches and still answers.
		 */
		const compiled = await compileFixture(referenceDir, "ambiguous", { outName: "ambiguous" });
		expect(compiled.diagnostics.map((d) => `${d.severity}: ${d.code}`)).toEqual([
			"warning: typespec-hono/ambiguous-server-path",
		]);
		expect(await mountedPaths(compiled.outDir)).toEqual(["/things"]);
	}, 300_000);
});
