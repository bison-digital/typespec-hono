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

	it("registers no HEAD route, because Hono converts HEAD before matching", () => {
		/**
		 * ⚠️ **Both spellings**, because `app.on("HEAD", …)` reaches the same dead end as `app.head()`
		 * and only one of them is obvious. The reference service declares a `@head` operation precisely
		 * so this arm has something to refuse.
		 */
		expect(source).not.toMatch(/\.head\(/);
		expect(source).not.toMatch(/"HEAD"/);
	});
});
