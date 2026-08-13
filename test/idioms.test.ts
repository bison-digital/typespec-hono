import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "./support/compile-fixture.js";

/**
 * **The generated server is what a Hono author would have written.**
 *
 * ⚠️ **Every rule below is Hono's own, from its best-practices guide, and not a house style.** That
 * distinction is the point: generated code is read far more often than it is written, and a reader
 * who knows Hono should recognise it immediately rather than learn one emitter's dialect. Where the
 * guide is explicit, this asserts what it says; where it is silent, this asserts nothing.
 *
 * The four the guide states, and what each is worth:
 *
 * 1. **Handlers inline, directly after the path definition.** The guide refuses "Ruby on Rails-like
 *    Controllers" for a concrete reason rather than a stylistic one — *"the path parameter cannot be
 *    inferred in the Controller without writing complex generics"*. Lifting handlers out would cost
 *    the typing this emitter exists to provide.
 * 2. **`app.route()` to compose a larger application**, a sub-app per resource.
 * 3. **Chaining, for RPC.** *"If you want to use the RPC feature, you can get the correct type by
 *    chaining"*. This one was learned the hard way: as separate statements `hc<typeof app>` resolved
 *    to `unknown`.
 * 4. **No dedicated `app.head()` handlers** — *"they won't execute as HEAD requests are converted
 *    before route matching"*. This package's `unroutable-verb` refusal was derived independently by
 *    reading `hono-base.js`, and the guide says the same thing outright.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let source = "";

beforeAll(async () => {
	const compiled = await compileFixture(join(here, "reference"), "service", {
		outName: "service-idioms",
	});
	source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
}, 600_000);

describe("the emitted server follows Hono's own best practices", () => {
	it("has a generated server to inspect at all", () => {
		expect(source.length).toBeGreaterThan(500);
		expect(source).toContain("registerRoutes");
	});

	it("writes every handler inline, after the path it serves", () => {
		/**
		 * ⚠️ **Asserted as "no extracted handler exists", not as "some inline handler exists".** The
		 * second is satisfied by output that lifts half its handlers out, which is the arrangement the
		 * guide warns against and the one that would silently cost path-parameter inference.
		 */
		expect((source.match(/async \(c\) => \{/g) ?? []).length).toBeGreaterThanOrEqual(5);
		expect(source).not.toMatch(/^(?:const|function)\s+\w*[Hh]andler\w*\s*[=(]/m);
		// A handler referenced by name rather than written in place is the same defect wearing a hat.
		expect(source).not.toMatch(/\.(get|post|put|patch|delete)\([^)]*,\s*\w+Handler\s*\)/);
	});

	it("composes resources with app.route(), rather than by prefixing every path", () => {
		const mounts = [...source.matchAll(/\.route\("([^"]+)",\s*(\w+)\)/g)];
		expect(mounts.length).toBeGreaterThanOrEqual(1);
		// Each mounted sub-app is a `new Hono`, declared as its own chain.
		for (const [, , name] of mounts) {
			expect(source).toMatch(new RegExp(`const ${name} = new Hono<AppEnv>\\(\\)`));
		}
	});

	it("chains every registration and returns the chain, which is what RPC reads", () => {
		expect((source.match(/^\t\t\.\w+\(/gm) ?? []).length).toBeGreaterThanOrEqual(5);
		// A standalone `app.get(...)` statement discards the type the chain accumulates.
		expect(source).not.toMatch(/^\t(?:app|\w+Routes)\.(get|post|put|patch|delete|on)\(/m);
		expect(source).toMatch(/\treturn app\n/);
	});

	it("serves a HEAD operation under GET, which is the only verb Hono dispatches", () => {
		/**
		 * Hono rewrites every HEAD request to GET before matching, so `app.head()` and
		 * `app.on("HEAD", ...)` are both dead ends -- Hono's own best-practices guide says so outright.
		 * Registering under GET is what makes the operation reachable, and Hono strips the response
		 * body for a real HEAD itself, which is what RFC 9110 requires.
		 *
		 * The reference service declares a `@head` operation so this arm has something to check.
		 */
		expect(source).not.toMatch(/\.head\(/);
		expect(source).not.toMatch(/\.on\(\s*"HEAD"/);
		// Reachable, and told apart from a GET the only way Hono leaves open.
		expect(source).toMatch(/c\.req\.method === "HEAD"|headOnly,/);
	});

	it("contains no type assertion, because a cast in generated code is nobody's to review", () => {
		/**
		 * ⚠️ **A cast in emitted output is worse than one in hand-written code.** Nobody reviews it, it
		 * reappears on every compile, and it is precisely the thing this emitter exists to spare a
		 * consumer writing. One shipped: `deps.context(c, "none") as Ctx`, on every unauthenticated
		 * route, asserting a non-null the type system could not see.
		 *
		 * ⚠️ **The fix was to CHECK rather than to overload.** Overloading `context` so `"none"` cannot
		 * return null does remove the cast from here — and puts one in every consumer's `deps`, because
		 * an overloaded property type stops contextually typing a single implementation. Measured: the
		 * wiring consumer lost parameter inference on every hook. Trading a cast in generated code for a
		 * cast in hand-written code is the wrong direction, so the generated route checks for null on
		 * every path instead.
		 *
		 * Asserted as a CLASS over the whole file — `as X`, `as unknown as X`, and non-null `!` — so a
		 * different assertion cannot arrive under a different spelling.
		 */
		/**
		 * ⚠️ **Comments are stripped first, and the first draft of this arm did not.** It matched the
		 * prose "so T infers as Operations" inside a docblock and accused the emitter of a cast it does
		 * not write. A rule that cries wolf on English gets suppressed, and a suppressed rule guards
		 * nothing — so this reads code, which is what it is a rule about.
		 */
		const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
		expect(code).not.toMatch(/\bas\s+[A-Z]\w*/);
		expect(code).not.toMatch(/\bas\s+unknown\b/);
		expect(code).not.toMatch(/\w!\.|\w!\)|\w!,/);
		expect(code).not.toMatch(/@ts-(expect-error|ignore)/);
	});
});
