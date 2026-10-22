import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { $lib } from "../src/lib.js";
import { $linter } from "../src/linter.js";
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

	/**
	 * **A linter rule is invisible until a project enables it, so its documentation is the only way
	 * anyone learns it exists.** A diagnostic announces itself the first time it fires; an opt-in rule
	 * never fires for a project that has not heard of it. So every rule the linter ships - including
	 * the one registered from `typespec-http-zod` - must appear in the reference's own table, and the
	 * reference must say how to turn the ruleset on.
	 */
	it("documents every linter rule it ships, and how to enable them", () => {
		const reference = readFileSync(join(packageRoot, "docs", "reference.md"), "utf8");
		const section = reference.slice(reference.indexOf("## Linter rules"));
		expect(section.length, "docs/reference.md has no '## Linter rules' section").toBeGreaterThan(
			20,
		);
		const rules = $linter.rules.map((rule) => rule.name);
		expect(rules.length).toBeGreaterThanOrEqual(2);
		const undocumented = rules.filter(
			(name) => !section.split("\n").some((line) => line.startsWith(`| \`${name}\``)),
		);
		expect(undocumented, `rules missing from the table: ${undocumented.join(", ")}`).toEqual([]);
		for (const ruleSet of Object.keys($linter.ruleSets ?? {})) {
			expect(reference).toContain(`"typespec-hono/${ruleSet}"`);
		}
	});

	it("names every option it accepts", () => {
		const options = Object.keys(EmitterOptionsSchema.properties ?? {});
		expect(options.length).toBeGreaterThanOrEqual(6);
		expect(options.filter((option) => !reference.includes(`\`${option}\``)).toSorted()).toEqual([]);
	});

	it("documents every diagnostic that has a call site, and declares none that has not", () => {
		/**
		 * **A declared diagnostic with no call site is coverage that does not exist.** It reads as a
		 * capability (the package refuses this thing) while nothing can ever raise it, and asserting
		 * the class is what catches one rather than leaving it to be noticed.
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
		 * **A number in a baseline file is not a stated limitation.** It is a counter a reader of the
		 * published package has no way to learn about. So each one is named in the reference, and this
		 * arm checks the numbers there against the numbers the suite actually measured. A limit
		 * documented with a stale figure is worse than none.
		 */
		const baseline = JSON.parse(
			readFileSync(join(packageRoot, "test", "conformance", "baseline.json"), "utf8"),
		) as { declared: number; mounted: number; refused: number };
		expect(reference).toContain(`${baseline.declared} declared`);
		expect(reference).toContain(`${baseline.mounted} mounted`);
		expect(reference).toContain(`${baseline.refused} refused`);
	});
});

/**
 * **The two documentation gates above check that NAMES appear. Nothing checked that CLAIMS are true.**
 *
 * That gap shipped: `docs/guides.md` told a reader a `bytes` body is read with `arrayBuffer()` for
 * binary media types, which stopped being so when the streamed body landed and the handler started
 * receiving an unread `ReadableStream`. The code said the opposite in bold, three lines above the
 * function that decides it, for two releases.
 *
 * Prose about emitted TYPES is the part a reader acts on, so it is the part worth grading. This is
 * narrow on purpose: it pins the one claim that has already drifted, against the source of truth for
 * it, rather than trying to parse the guide.
 */
describe("the guides describe the types this emitter actually emits", () => {
	const guides = readFileSync(join(packageRoot, "docs", "guides.md"), "utf8");
	const appSource = readFileSync(join(packageRoot, "src", "app.ts"), "utf8");

	it("states the binary body type that `rawBodyReaderFor` actually emits", () => {
		const emitted = /type: "(ReadableStream<[^"]+>[^"]*)"/.exec(appSource)?.[1];
		expect(emitted, "rawBodyReaderFor no longer spells its type this way").toBeDefined();
		expect(guides).toContain(emitted ?? " ");
	});

	it("does not still say a binary body is read with arrayBuffer()", () => {
		// The exact sentence that was wrong. `arrayBuffer()` still appears in the guide as the one line
		// a handler writes when it wants the bytes, which is correct, so this pins the claim not the word.
		expect(guides).not.toMatch(/`bytes` body is read with `arrayBuffer\(\)`/);
	});

	/**
	 * **The figure this package WRITES INTO a generated tree must be the figure it measured.**
	 *
	 * `SYNC_PARSE` is emitted verbatim into every generated `app.gen.ts`, so its number is read by
	 * people who cannot see the measurement behind it. It said 2.6x, taken on zod 4.5.2, while the
	 * docblock immediately above it had been re-measured on 4.6.5 at 3.4x and the emitted copy was
	 * not moved with it. The same class as the `arrayBuffer()` sentence above: documentation that
	 * was wrong rather than missing, and no arm graded it.
	 */
	it("emits the same sync-versus-async figure that it measured", () => {
		const measured = /\| `safeParseAsync` \| (\d+) \|[\s\S]*?\| `safeParse` \| (\d+) \|/.exec(
			appSource,
		);
		expect(measured, "the measurement table in src/app.ts no longer reads this way").toBeDefined();
		const ratio = Number(measured?.[1]) / Number(measured?.[2]);
		const claimed = /the async path costs ([\d.]+)x/.exec(appSource)?.[1];
		expect(claimed, "SYNC_PARSE no longer states a multiplier").toBeDefined();
		expect(Number(claimed)).toBeCloseTo(ratio, 1);
	});
});
