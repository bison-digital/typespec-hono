import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileScenario, discoverScenarios } from "../conformance/corpus.js";
import { compileFixture } from "./compile-fixture.js";

/**
 * **A deterministic set of emitted output, compiled by the suite that grades it.**
 *
 * ⚠️ **This exists because three oracles here graded whatever `.gen.ts` files happened to be on
 * disk.** `vocabulary.test.ts`, `packaging.test.ts` and `provenance.test.ts` each walked `test/` for
 * emitted output — output written by OTHER test files. Vitest runs test files in parallel and nothing
 * ordered them, so each read whatever the previous run left behind. Measured in both packages, and
 * reproducible in both directions:
 *
 * - **clean tree → RED.** `pnpm test` on a fresh checkout failed with every floor at 0, because the
 *   files did not exist yet when these suites ran. Confirmed in the library at `a4b0b93`, before any
 *   of the work around this — so neither package's suite has ever passed on a fresh clone, which is
 *   exactly what CI does and what the first contributor to clone the repository will do.
 * - **populated tree → GREEN.** A second consecutive run passes by grading the *previous* build. A
 *   control that deleted a fix from `src/` passed green for that reason, while the output on disk
 *   afterwards contained none of it. A guard that grades the previous build is worse than no guard.
 *
 * ⚠️ **Each caller gets its OWN directory, and that is not tidiness.** Two suites compiling one
 * fixture into one directory with different options overwrite each other — the failure that once made
 * the same request answer 400, 200 and 204 across three runs of an unchanged emitter.
 * `isolation.test.ts` asserts no two test files share a destination.
 */

// `../..` because this file lives in `test/support/`, where `..` is `test/` and not the root.
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The fixtures compiled for these sweeps — every `.tsp` this package owns, so a sweep cannot be
 * narrower than the emitter's own surface. A fixture added without being swept is a gap, and listing
 * them here is what makes adding one to the sweep a deliberate act rather than an omission.
 */
export const SWEPT_FIXTURES: readonly (readonly [dir: string, name: string])[] = [
	["authz", "guarded"],
	["equivalence", "api"],
	["reference", "service"],
	// Every transport encoding that needs decoding, so the wire arms are not vacuous here either.
	["reference", "wire"],
];

/** Every `.gen.ts` under a directory. */
export function generatedFilesUnder(root: string): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith(".gen.ts")) found.push(full);
		}
	};
	walk(root);
	return found;
}

/**
 * Compile {@link SWEPT_FIXTURES} into a directory of this caller's own and hand back what landed.
 *
 * `outName` must be unique per suite — see the docblock above for what sharing one costs.
 */
export async function compileEmittedSet(outName: string): Promise<string[]> {
	const outputRoot = join(packageRoot, "test", `.out-${outName}`);
	rmSync(outputRoot, { recursive: true, force: true });
	for (const [dir, name] of SWEPT_FIXTURES) {
		await compileFixture(join(packageRoot, "test", dir), name, {
			outDir: join(outputRoot, `${dir}__${name}`),
		});
	}
	/**
	 * ⚠️ **The whole corpus as well, and not only the local fixtures.**
	 *
	 * The sweep this replaced walked `test/` and therefore happened to include every corpus scenario —
	 * broad, but grading whatever the previous run had left on disk. The first attempt at fixing that
	 * kept the determinism and quietly dropped the breadth: 61 scenarios became 4 fixtures, and the
	 * floors were lowered to match. Lowering a floor to fit reduced coverage is how a guard stops
	 * guarding, so the breadth is restored here instead — compiled into this caller's own directory, so
	 * it is deterministic AND wide.
	 *
	 * Costs one corpus compile per sweep. Measured at roughly five seconds for the whole suite, which
	 * is worth paying for an arm that reads every file this emitter can produce.
	 */
	for (const scenario of discoverScenarios()) {
		try {
			await compileScenario(scenario, join(outputRoot, "corpus"));
		} catch {
			// A scenario that cannot compile is graded by `routes.test.ts`, which owns that question.
			// Swallowing it here keeps a corpus defect from disguising itself as a vocabulary failure.
		}
	}
	return generatedFilesUnder(outputRoot);
}
