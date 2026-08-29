import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { $lib } from "../src/lib.js";
import { EmitterOptionsSchema } from "../src/lib.js";

/**
 * **A user who hits a refusal should find it documented, not discover it.**
 *
 * **Documentation is asserted as a CLASS, the way every other rule here is.** A README listing the
 * diagnostics that existed when somebody last wrote it is a list that stops covering what the package
 * does, and the failure is silent. The reader concludes the emitter has no opinion about the thing
 * that just refused their spec.
 *
 * So a diagnostic or an option added later fails this suite until it is written down. That is the
 * whole mechanism: the cost of documenting is paid at the moment the capability is added, by the
 * person who knows why it exists.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const readme = readFileSync(join(packageRoot, "README.md"), "utf8");
/**
 * The reference lives in `docs/`, so the README can stay short enough to read. These arms follow it
 * there: what matters is that a capability is written down somewhere a reader is pointed to, not
 * which file it landed in.
 */
const reference = readFileSync(join(packageRoot, "docs", "reference.md"), "utf8");

describe("the README documents everything this package can do to you", () => {
	it("has the sections the arms below read, and links to them", () => {
		// Non-vacuity: every arm below passes trivially against an empty file.
		expect(readme.length).toBeGreaterThanOrEqual(2000);
		expect(reference.length).toBeGreaterThanOrEqual(1000);
		expect(reference).toMatch(/^## What it refuses, and why$/m);
		expect(reference).toMatch(/^## Options$/m);
		expect(reference).toMatch(/^## Known limits$/m);
		/**
		 * A reference nothing points at is a reference nobody reads, which is the failure mode of
		 * moving it out of the README in the first place.
		 */
		for (const doc of [
			"docs/guides.md",
			"docs/cloudflare-workers.md",
			"docs/reference.md",
			"docs/releasing.md",
		]) {
			expect(readme, `README does not link ${doc}`).toContain(`(${doc})`);
		}
	});

	it("names every diagnostic it can raise", () => {
		const codes = Object.keys($lib.diagnostics);
		/**
		 * One, and it is deliberate that this floor is not higher. Two diagnostics were deleted rather
		 * than documented better: `unroutable-verb` because a HEAD operation is served now, and
		 * `ambiguous-server-path` because several declared servers are all mounted. A floor that had
		 * been pinned at the old count would have made removing them look like a regression.
		 */
		expect(codes.length).toBeGreaterThanOrEqual(1);
		expect(codes.filter((code) => !reference.includes(`\`${code}\``)).toSorted()).toEqual([]);
	});

	it("names every option it accepts", () => {
		const options = Object.keys(EmitterOptionsSchema.properties ?? {});
		expect(options.length).toBeGreaterThanOrEqual(6);
		expect(options.filter((option) => !reference.includes(`\`${option}\``)).toSorted()).toEqual([]);
	});

	it("documents every diagnostic that has a call site, and declares none that has not", () => {
		/**
		 * **A declared diagnostic with no call site is coverage that does not exist.** It reads as a
		 * capability (the package refuses this thing) while nothing can ever raise it. Two of these
		 * sat here mid-extraction, both legitimately, because the code that reported them had not been
		 * carried across yet; asserting the class is what closed that window rather than leaving it to
		 * be noticed.
		 */
		const sources = ["app.ts", "emitter.ts", "runtime.ts", "lib.ts"]
			.map((name) => {
				try {
					return readFileSync(join(packageRoot, "src", name), "utf8");
				} catch {
					return "";
				}
			})
			.join("\n");
		const unreachable = Object.keys($lib.diagnostics).filter(
			(code) => !sources.includes(`code: "${code}"`),
		);
		expect(unreachable.toSorted()).toEqual([]);
	});

	it("states the refusal count as a limit, with its number", () => {
		/**
		 * **A number in a baseline file is not a stated limitation.** Inside a private package these
		 * are honest, visible counters; published, they are surfaces a reader has no way to learn about.
		 * So each one is named in the README, and this arm checks the numbers there against the numbers
		 * the suite actually measured. A limit documented with a stale figure is worse than none.
		 */
		const baseline = JSON.parse(
			readFileSync(join(packageRoot, "test", "conformance", "baseline.json"), "utf8"),
		) as { declared: number; mounted: number; refused: number };
		expect(reference).toContain(`${baseline.declared} declared`);
		expect(reference).toContain(`${baseline.mounted} mounted`);
		expect(reference).toContain(`${baseline.refused} refused`);
	});
});
