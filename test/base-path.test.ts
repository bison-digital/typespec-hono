import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { compileFixture } from "./support/compile-fixture.js";

/**
 * **The server serves the URLs the document publishes.**
 *
 * **An OpenAPI path is relative to its server.** `@server("/api/v1")` plus a path of `/things`
 * means the document publishes `/api/v1/things`, so a server mounting `/things` disagrees with the
 * document generated from the same spec, which is the one thing this project exists to prevent.
 * Measured before this existed: every client generated from the document, and every "try it" in a
 * rendered document, answered 404.
 *
 * **This file exists because the branch was written and graded by NOTHING.** Deleting base-path
 * resolution from `src/` entirely left all 122 tests green. Every other fixture in this suite either
 * declares no `@server` or a templated one, and `@typespec/http-specs` is almost entirely
 * `@server("{endpoint}")`, so the static case, which is what a real product declares, had no
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
		 * **Asked of `app.routes` rather than read out of the emitted text.** A prefix that appears in
		 * the source but does not reach the router is exactly the class of defect this suite has been
		 * bitten by, fifteen HEAD routes were "mounted" by every text-reading arm and dispatched to by
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

	it("mounts under every prefix the document declares, not one of them", async () => {
		/**
		 * **This used to warn and mount at the root, and that was wrong.** The reasoning was that
		 * several `@server` entries are ambiguous and no single prefix serves them all. The premise is
		 * false: the document is not asking which one to pick, it says the service answers at all of
		 * them, and Hono mounts one sub-app under as many prefixes as it is given. Mounting at the root
		 * meant every caller following the document 404d.
		 *
		 * Asked of `app.routes` rather than the emitted text, because a prefix that appears in the
		 * source but does not reach the router is the exact defect class this file exists for.
		 */
		const compiled = await compileFixture(referenceDir, "ambiguous", { outName: "ambiguous" });
		expect(compiled.diagnostics).toEqual([]);
		const paths = await mountedPaths(compiled.outDir);
		expect(paths).toEqual(["/api/v1/things", "/api/v2/things"]);
		// And nothing is left at the root, which the document does not publish.
		expect(paths.some((path) => path === "/things")).toBe(false);
	}, 300_000);
});

/**
 * **What compares the mounted prefix to the one the document publishes.**
 *
 * The arms above assert against paths written by hand. That is agreeing with ourselves: this emitter
 * asks `@typespec/http` for the servers and `@typespec/openapi3` walks the program itself, and
 * nothing forces the two to arrive at the same answer.
 *
 * The corpus cannot cover this. `@typespec/http-specs` declares `@server("{endpoint}")` almost
 * throughout, so a corpus arm had nothing static to compare and its non-vacuity floor said so. These
 * fixtures are the only place a static base path exists, which is why the comparison belongs here.
 *
 * It is not hypothetical. A service declaring a static `@server("/api/v1")` publishes every path under that
 * prefix, and a server mounting anywhere else answers 404 to every client generated from its own
 * document.
 */
describe("the mounted prefix is the one the document publishes", () => {
	/** The static path of each declared server, by the same rules `resolveBasePath` applies. */
	function declaredPrefixes(documentDir: string): string[] {
		const file = readdirSync(documentDir).find((name) => name.endsWith(".json"));
		if (file === undefined) return [];
		const document = JSON.parse(readFileSync(join(documentDir, file), "utf8")) as {
			readonly servers?: readonly { readonly url: string }[];
		};
		return (
			(document.servers ?? [])
				.map((server) => server.url)
				// A templated URL means the caller supplies the origin, so the root is already correct.
				.filter((url) => !url.includes("{"))
				.map((url) =>
					/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? (URL.parse(url)?.pathname ?? "/") : url,
				)
				.map((path) => path.replace(/\/+$/, ""))
				.filter((path) => path !== "" && path !== "/")
				.toSorted()
		);
	}

	function mountedPrefixes(outDir: string): string[] {
		const source = readFileSync(join(outDir, "app.gen.ts"), "utf8");
		return [...source.matchAll(/\.route\("([^"]+)", basePathRoutes\)/g)]
			.map((match) => match[1] ?? "")
			.toSorted();
	}

	it("agrees for a single declared base path", async () => {
		const compiled = await compileFixture(referenceDir, "based", {
			outName: "based-document",
			withDocument: true,
		});
		const declared = declaredPrefixes(compiled.documentDir);
		expect(declared).toEqual(["/api/v1"]);
		expect(mountedPrefixes(compiled.outDir)).toEqual(declared);
	}, 300_000);

	it("agrees when the document declares several", async () => {
		const compiled = await compileFixture(referenceDir, "ambiguous", {
			outName: "ambiguous-document",
			withDocument: true,
		});
		const declared = declaredPrefixes(compiled.documentDir);
		/**
		 * Non-vacuity for the comparison: two servers that produced no static prefix would make the
		 * assertion below `[] === []`, which is true of an emitter that mounts nothing anywhere.
		 */
		expect(declared.length).toBeGreaterThanOrEqual(2);
		expect(mountedPrefixes(compiled.outDir)).toEqual(declared);
	}, 300_000);
});
