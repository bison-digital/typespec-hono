import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { $lib } from "../src/lib.js";
import { compileFixture } from "./support/compile-fixture.js";

/**
 * **What a stranger gets when they configure nothing.**
 *
 * **This is the branch no other test in either package could reach.** Every compile in this suite
 * and in the library's sets `runtime-module` explicitly, `test/support/compile-fixture.ts` does it,
 * `test/conformance/corpus.ts` does it, so across 83 tests here and 157 there, the emitter's own
 * default was never once exercised. It was wrong, and it had always been wrong:
 *
 * - it named `typespec-http-zod/runtime`, which exports `ResponseArm` and `armFor` and **none** of the
 *   six names `app.gen.ts` imports (`AppEnv`, `Awaitable`, `Ctx`, `Result`, `RouteDeps`,
 *   `selectContentType`); and
 * - `typespec-http-zod` is a TRANSITIVE dependency of a consumer of this package, so under a strict
 *   `node_modules` that specifier does not resolve from consumer code whatever it exports.
 *
 * Measured in a fresh project installed from `pnpm pack` tarballs: `tsp compile` reported **zero**
 * diagnostics and wrote both files, and `tsc` then reported **two `TS2307`s**, one per generated file.
 * An emitter that succeeds and emits something that cannot compile is the worst shape of failure
 * available to it, because every signal says it worked.
 *
 * **The oracle is a COMPILE, not a list of expected specifiers.** A list would have to be kept by
 * hand and would stop covering the emitter the first time it referenced something new; and the thing
 * that actually matters ("can a consumer build this") is exactly what `tsc` answers. Type-only
 * imports settle it: `Ctx` and `RouteDeps` have no runtime existence, so no amount of inspecting a
 * loaded module could tell you they were missing.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const referenceDir = join(here, "reference");
let outDir = "";

beforeAll(async () => {
	// `bare`. Nothing set but the output directory, which is what the README's example produces.
	const compiled = await compileFixture(referenceDir, "service", {
		bare: true,
		outName: "service-bare",
	});
	outDir = compiled.outDir;
	/**
	 * **A named refusal is not a failure, and conflating the two blinds the arm.** The reference
	 * service declares a `@head` operation on purpose, so `unroutable-verb` is the expected, documented
	 * outcome for it, and every other operation still emits, because `reportDiagnostic` does not
	 * unwind. What must not appear is an error this package has not named.
	 *
	 * Read from `$lib` rather than listed here: a refusal added without this arm noticing is exactly
	 * the drift a hand-kept list produces.
	 */
	const named = new Set(Object.keys($lib.diagnostics).map((code) => `typespec-hono/${code}`));
	const unexpected = compiled.diagnostics.filter(
		(d) => d.severity === "error" && !named.has(d.code),
	);
	expect(unexpected).toEqual([]);
}, 300_000);

describe("output emitted with no options but the output directory", () => {
	it("emits the files a consumer is told to expect", () => {
		const emitted = readdirSync(outDir).filter((name) => name.endsWith(".ts"));
		// A floor, not a list: this arm must never pass by comparing nothing.
		expect(emitted.length).toBeGreaterThanOrEqual(2);
		expect(emitted).toContain("app.gen.ts");
		expect(emitted).toContain("schemas.gen.ts");
	});

	it("imports its runtime contract from a module that is this package's to publish", () => {
		/**
		 * **Asserted as a CLASS: whatever module the generated files name, they must all name the
		 * SAME one, and it must be reachable from a consumer.** The specific string is not the fact
		 * worth pinning. That the two files agree, and that the specifier is one a consumer's own
		 * dependency provides, is.
		 *
		 * A consumer installs `typespec-hono`. Anything under `typespec-http-zod/` is that package's
		 * transitive dependency and is not theirs to import.
		 */
		const specifiers = new Set(
			readdirSync(outDir)
				.filter((name) => name.endsWith(".gen.ts"))
				.flatMap((name) =>
					[
						...readFileSync(join(outDir, name), "utf8").matchAll(
							/^import\s[^"']*from\s*"([^"]+)"/gm,
						),
					].map((match) => match[1] ?? ""),
				)
				.filter((specifier) => /runtime/.test(specifier)),
		);
		expect(specifiers.size).toBe(1);
		const [runtime] = [...specifiers];
		expect(runtime).not.toMatch(/^typespec-http-zod\b/);
	});

	it("compiles, which is the whole claim, and the part that was false", () => {
		const config = join(outDir, "tsconfig.adopter.json");
		writeFileSync(
			config,
			JSON.stringify({
				compilerOptions: {
					target: "es2023",
					module: "nodenext",
					moduleResolution: "nodenext",
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					types: [],
				},
				include: ["./*.gen.ts"],
			}),
		);
		let output = "";
		try {
			execFileSync(
				join(here, "..", "node_modules", ".bin", "tsc"),
				["-p", config, "--ignoreConfig"],
				{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			);
		} catch (error) {
			const asExec = error as { stdout?: string; stderr?: string };
			output = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`;
		}
		expect(output.trim(), output).toBe("");
	});
});
