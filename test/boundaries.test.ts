import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **What the emitter's behaviour may rest on, checked rather than remembered.** Its behaviour comes
 * from the TypeSpec language and from what `typespec-http-zod` publishes, never from a name one spec
 * happens to use or from a library internal.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const src = join(packageRoot, "src");

/**
 * Every hand-written `.ts` and `.tsp` file under `src/` and `test/`. `.out*` directories hold
 * generated files, which are graded by other suites; treating them as hand-written would grade the
 * emitter's output against a rule written for its source.
 */
function handWrittenFiles(): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			if (entry.startsWith(".out") || entry === "node_modules" || entry === "dist") continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith(".ts") || entry.endsWith(".tsp")) found.push(full);
		}
	};
	walk(src);
	walk(join(packageRoot, "test"));
	return found;
}

describe("behaviour comes from the language, not from a spec author's names", () => {
	const files = handWrittenFiles();

	it("has source to inspect at all", () => {
		// Without this the arm below passes the day the walk stops finding files.
		expect(files.length).toBeGreaterThanOrEqual(15);
	});

	it("keys no behaviour on a name the spec AUTHOR chose", () => {
		/**
		 * **`.kind` is TypeSpec's vocabulary and `.name` is the spec author's.** Branching on
		 * `type.kind === "Model"` is reading the language; branching on `parameter.name === "ownerId"`
		 * decides that one word means something in every spec that uses it, which is a rule no document
		 * states. A filter on a literal property name is code, not a comment, and reads as ordinary.
		 *
		 * The exception is a name TypeSpec itself decides: `bytes`, `Record`, `never`, the empty name an
		 * anonymous model carries. That is a closed first-party set, not a list this package maintains.
		 */
		const TYPESPEC_BUILT_IN =
			/^(|null|unknown|void|never|bytes|integer|string|boolean|numeric|Array|Record|File)$/;
		const offenders: string[] = [];
		for (const file of files) {
			const lines = readFileSync(file, "utf8").split("\n");
			lines.forEach((line, index) => {
				if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
				for (const match of line.matchAll(/\.name\s*[=!]==\s*"([^"]*)"/g)) {
					const literal = match[1] ?? "";
					if (!TYPESPEC_BUILT_IN.test(literal)) {
						offenders.push(`${file}:${index + 1}: keyed on the author-chosen name "${literal}"`);
					}
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});

/**
 * **The emitter entry point uses nothing `typespec-http-zod` does not export.** This is the
 * mechanical proof that the library's published API is sufficient to build a server generator on:
 * the library's `exports` map forbids a deep import, so anything this file cannot do from the
 * published surface is a gap in that surface, to be fixed there rather than worked around here.
 * Asserted over every specifier the file names, so a new import cannot slip in unexamined.
 */
describe("the emitter is written against the published API", () => {
	const source = readFileSync(join(src, "emitter.ts"), "utf8");

	it("reaches into `typespec-http-zod` only through what it publishes", () => {
		const specifiers = [
			...source.matchAll(/^(?:import|export)\s(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm),
		].map((match) => match[1] ?? "");
		expect(specifiers.length).toBeGreaterThanOrEqual(3);
		const deepImport = specifiers.filter((specifier) =>
			/^typespec-http-zod\/(?!runtime$)/.test(specifier),
		);
		expect(deepImport).toEqual([]);
	});

	it("emits the server and its runtime, and delegates everything else", () => {
		/**
		 * This package runs the library and adds a server. An emitter that grew further `emitFile`
		 * calls would be doing work the library should own, or duplicating work it already does.
		 *
		 * Two, not one, and the second is deliberate: `runtime.gen.ts` is a copy of this package's own
		 * runtime, written beside the generated code so that nothing emitted imports this package at
		 * run time. That is what lets it be a devDependency.
		 *
		 * The delegation is asserted as a class, not a call spelling: the library is invoked exactly
		 * once and receives the emit context, with `runtime-module` removed (see
		 * `runtime-module-removed`). What else it is told is this package's business.
		 */
		expect([...source.matchAll(/emitFile\(/g)].length).toBe(2);
		expect(source).toContain("runtime.gen.ts");
		const delegations = [...source.matchAll(/emitHttpZod\(\s*(?:withoutRuntimeModule\()?(\w+)/g)];
		expect(delegations.length).toBe(1);
		expect(delegations[0]?.[1]).toBe("context");
	});
});
