import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **The scope gate the document publishes is the gate the generated server applies.**
 *
 * ⚠️ **This is checked on the emitted SOURCE, and it has to be.** Nothing a request can observe
 * distinguishes a server that enforces scopes from one that does not, unless the app's `authorize`
 * happens to reject — and the app is exactly what we are not testing here. The defect it guards
 * against shipped once: the generated app referenced scopes zero times while the published document
 * declared eleven, so a surface mounted with its OAuth gate silently dropped.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("an operation's declared scopes reach the generated server", () => {
	let source: string;
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "guarded");
		source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
	});

	it("compiles without an error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("gates the scoped operation with exactly the scopes the spec declares", () => {
		expect(source).toContain('deps.authorize(["widgets:read"])');
	});

	it("gates only the scoped operations, not every route", () => {
		// Paired with the arm above: a generator that gated everything would pass that one alone.
		// Two scoped operations, one `@useAuth(NoAuth)` — so the count is a real discriminator.
		expect(source.split("deps.authorize(").length - 1).toBe(2);
	});

	it("puts the gate BEFORE the validators", () => {
		/**
		 * A caller without the scope must be refused whatever their body looks like. Validating first
		 * answers 400 to a request the contract says is not theirs to make, which tells somebody who
		 * may not call the operation at all which payloads are well-formed.
		 */
		const gate = source.indexOf("deps.authorize(");
		const firstValidator = source.indexOf("zValidator(");
		// Both asserted present first: a `-1` from either would satisfy the comparison and prove
		// nothing, which is why the fixture declares an operation that is scoped AND validated.
		expect(gate).toBeGreaterThan(-1);
		expect(firstValidator).toBeGreaterThan(-1);
		expect(gate).toBeLessThan(firstValidator);
	});
});
