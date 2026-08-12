import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **Question 2 of three: is the emitted server what a Hono author would have written?**
 *
 * The reference service is shared with `typespec-http-zod` and vendored here — see `PROVENANCE.md`.
 * Every construct in it is one that has broken an emitter, and the arms below name which.
 *
 * ⚠️ **Route counts come from `app.routes`, never from the emitted text.** An emitter that writes a
 * route it cannot mount produces a file where every text-counting arm agrees with the document and no
 * caller can reach anything. That is not hypothetical: a hyphenated path parameter once mounted at the
 * literal string `/things/{thing-id}` and answered 404 to the only requests it existed for, while
 * every count read it as present.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "service");
});

/** Mount the real `registerRoutes`, with stubs that are never called — registration invokes nothing. */
async function mount(): Promise<Hono> {
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	const app = new Hono();
	const noop = (): undefined => undefined;
	server.registerRoutes(app, () => new Proxy({}, { get: () => noop }), new Proxy({}, { get: () => noop }));
	return app;
}

describe("the emitted server mounts what the document declares", () => {
	it("refuses exactly what it cannot route, and nothing else", () => {
		/**
		 * ⚠️ **One named refusal, and it is a fact about Hono rather than about the spec.** `widgetExists`
		 * is `@head`, and Hono rewrites every HEAD request to GET before matching — so a route registered
		 * under HEAD is unreachable. The library emits correct validators for the operation; only a Hono
		 * server cannot serve it.
		 *
		 * Named rather than counted: a refusal is a claim about the reference spec and has to be read.
		 */
		expect(compiled.diagnostics.map((d) => `${d.severity}: ${d.code}`)).toEqual([
			"error: typespec-hono/unroutable-verb",
		]);
	});

	it("mounts one route per verb and path, with nothing unreachable behind it", async () => {
		const app = await mount();
		const slots = [
			...new Set(
				app.routes.filter((route) => route.method !== "ALL").map((r) => `${r.method} ${r.path}`),
			),
		];
		/**
		 * ⚠️ **Registrations are counted from the SOURCE, because `app.routes` cannot answer this.**
		 * Hono lists one entry per middleware as well as per handler, all sharing the slot, so a
		 * duplicate registration is indistinguishable from a validator — and de-duplicating first, which
		 * the slot list has to do, makes a second registration invisible. A control caught exactly that.
		 */
		const registrations = [
			...readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8").matchAll(/^\tapp\.\w+\(/gm),
		].length;
		expect(registrations).toBe(slots.length);
		/**
		 * The service declares 11 operations. Two on `/report` share a slot and negotiate; one is
		 * `@head` and is refused, because Hono cannot dispatch to it. Nine remain.
		 */
		expect(slots.length).toBe(9);
	});

	it("converts a hyphenated path parameter rather than mounting it literally", async () => {
		const app = await mount();
		const paths = app.routes.map((route) => route.path);
		expect(paths).toContain("/widgets/:widget-id");
		expect(paths.filter((path) => path.includes("{"))).toEqual([]);
	});

	it("mounts no route for a verb Hono cannot dispatch to", async () => {
		const app = await mount();
		/**
		 * ⚠️ **This arm asserted the OPPOSITE, and it was wrong for the whole life of the un-split
		 * emitter.** `app.on("HEAD", …)` looks like a mounted route and `app.routes` lists it, but
		 * `hono-base.js` rewrites every HEAD request to GET at the top of `#dispatch`, so it is never
		 * reached: 404 where the path has no GET, dead code where it has one. Measured on Hono 4.13.1,
		 * and measured against `on("PURGE", …)` and `on("OPTIONS", …)`, which both work — so this is
		 * HEAD specifically.
		 *
		 * Fifteen of the seventeen HEAD operations in `@typespec/http-specs` have no sibling GET. Every
		 * one was a 404 that a route differential counted as present.
		 */
		expect(app.routes.filter((route) => route.method === "HEAD")).toEqual([]);
		const source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
		expect(source).not.toMatch(/"HEAD"/);
	});

	it("registers a negotiated route once, and answers 406 rather than validating `accept`", () => {
		const source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
		const reportRegistrations = [...source.matchAll(/^\t\t"\/report",$/gm)].length;
		expect(reportRegistrations).toBe(1);
		expect(source).toMatch(/selectContentType\(c\.req\.header\("accept"\)/);
		expect(source).toMatch(/deps\.notAcceptable\(/);
		// `accept` SELECTS the operation, so validating it against one member's literal would answer
		// 400 to a well-formed request whose real answer is 406.
		expect(source).not.toMatch(/zValidator\("header", Report_/);
	});

	it("declares no validator of its own — every one is imported from the library's output", () => {
		const source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
		/**
		 * ⚠️ **The whole split turns on this.** If the server file declares a schema, then two emitters
		 * are minting identifiers and agreeing by coincidence. Every `const` it names must come from
		 * `schemas.gen.js`, which `typespec-http-zod` wrote.
		 */
		expect(source).not.toMatch(/^export const \w+Schema = /m);
		expect(source).not.toMatch(/^export const \w+(Path|Query|Header|Body|Responses) = /m);
		const imported = /import \{([^}]+)\} from "\.\/schemas\.gen\.js";/.exec(source)?.[1] ?? "";
		expect(imported.split(",").filter((n) => n.trim() !== "").length).toBeGreaterThanOrEqual(20);
	});

	it("passes tsc under the settings a consumer builds with", () => {
		const config = join(compiled.outDir, "tsconfig.emitted.json");
		writeFileSync(
			config,
			JSON.stringify({
				compilerOptions: {
					target: "es2023", module: "nodenext", moduleResolution: "nodenext",
					strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true,
					noEmit: true, skipLibCheck: true, types: [],
				},
				include: ["./*.ts"],
			}),
		);
		let output = "";
		try {
			execFileSync(join(here, "..", "..", "node_modules", ".bin", "tsc"), ["-p", config, "--ignoreConfig"], {
				encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			const asExec = error as { stdout?: string; stderr?: string };
			output = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`;
		}
		expect(output.trim(), output).toBe("");
	});
});
