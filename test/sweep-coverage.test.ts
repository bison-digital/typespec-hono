import { describe, expect, it } from "vitest";
import { discoverScenarios } from "./conformance/corpus.js";
import { SWEPT_FIXTURES, compileEmittedSet } from "./support/emitted-set.js";

/**
 * **The sweeps read every scenario the corpus contains, not a subset somebody chose.**
 *
 * ⚠️ **This arm exists because the coverage was quietly narrowed once, by me, to make a floor pass.**
 * `vocabulary.test.ts` and `packaging.test.ts` used to walk `test/` for emitted output, which happened
 * to include all 61 corpus scenarios — broad, but non-deterministic, because those files were written
 * by other test files that vitest runs in parallel with nothing ordering them. Fixing the determinism
 * by compiling a handful of local fixtures instead took the sweep from ~300 files to 19 and from 69
 * generated servers to 4, and the floors were lowered to match.
 *
 * That is the shape of the mistake worth guarding against: **the numbers all stayed green while the
 * thing being measured shrank by an order of magnitude.** A floor cannot catch it, because a floor is
 * exactly what gets adjusted. So this asserts the coverage against the corpus ITSELF — a source
 * neither this file nor the sweep controls — rather than against a number anybody can edit.
 *
 * ⚠️ **Derived, never restated.** `discoverScenarios()` is the same function the route differential
 * uses, so the expected breadth moves with a corpus bump instead of going stale. Hard-coding "61"
 * here would reintroduce the maintenance-by-memory this whole suite is built to avoid.
 */

describe("the vocabulary sweeps grade the whole corpus, not a chosen subset", () => {
	it("compiles one output directory per corpus scenario, plus every local fixture", async () => {
		const scenarios = discoverScenarios();
		// Non-vacuity: discovery that finds nothing would make every assertion below trivially true.
		expect(scenarios.length).toBeGreaterThanOrEqual(60);

		const files = await compileEmittedSet("coverage");

		/**
		 * Every scenario contributes emitted files under its own directory. Asserted by NAME rather
		 * than by count, so a sweep that silently stopped compiling some of them is named here instead
		 * of showing up as a slightly smaller number nobody questions.
		 */
		const covered = new Set(
			files
				.map((file) => /[/\\]corpus[/\\]([^/\\]+)[/\\]/.exec(file)?.[1])
				.filter((name): name is string => name !== undefined),
		);
		const missing = scenarios
			.map((scenario) => scenario.name.replaceAll("/", "__"))
			.filter((name) => !covered.has(name))
			.toSorted();
		/**
		 * ⚠️ **Not empty, and it must not be.** A handful of scenarios emit nothing at all — openapi3
		 * crashes on `special-words`, and `routes` declares a path OpenAPI cannot express. Those are the
		 * oracle's defects, named in `corpus.ts`, and `routes.test.ts` owns them. A CEILING rather than
		 * an equality, so the known few are tolerated and a new one is not.
		 */
		expect(missing.length, `scenarios contributing no swept output: ${missing.join(", ")}`)
			.toBeLessThanOrEqual(3);

		// And the local fixtures, which carry the depth the corpus does not.
		for (const [dir, name] of SWEPT_FIXTURES) {
			expect(
				files.some((file) => file.includes(`${dir}__${name}`)),
				`no swept output for the ${dir}/${name} fixture`,
			).toBe(true);
		}
	}, 900_000);
});
