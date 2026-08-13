import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Nothing in this package may name the codebase it was extracted from.**
 *
 * **This is not tidiness, and one of these was a live defect rather than a comment.** The emitter
 * carried `.filter((parameter) => parameter.name !== "companyId")`, one application's tenant
 * identifier, dropped from every consumer's generated input type while the validator went on
 * requiring it. Behaviour derived from nothing any document states, which is the exact class this
 * emitter exists to delete, sitting in the emitter itself.
 *
 * The rest were prose, and prose matters here more than usual: these docblocks are the record of WHY
 * each rule exists, and a reader who cannot see the repository they cite gets an explanation that
 * explains nothing. One of them shipped, `"the gateway's validator and the shared wire type describe
 * different shapes"` was the failure message in every consumer's build output.
 *
 * Asserted as a CLASS over the whole of `src/`, so a term reintroduced anywhere fails here rather
 * than in a review that may not happen.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const src = join(packageRoot, "src");

/**
 * Terms belonging to the codebase this was extracted from.
 *
 * Two kinds, and both matter: proper nouns nobody else has (`@cm/...`, `cm.tsp`, a registrar), and
 * ordinary words used as if they named a specific component (`the gateway`, `the domain`). The second
 * kind is the one that reads as generic and is not. A docblock saying "the domain asserts this"
 * describes an arrangement the reader has no reason to have.
 */
const FOREIGN = [
	/@cm\//,
	/\bcm\.tsp\b/,
	/\bpublic\.tsp\b/,
	/\bCmApi\b/,
	/\bCmPublicApi\b/,
	/\bapi-spec\b/,
	/\bCompanies House\b/,
	/\bAgentBooks\b/,
	/\/public\/v1\b/,
	/\bregistrar\b/,
	/\bArchUnit/,
	/\bFILING_STATES\b/,
	/\bthe gateway\b/,
	/\bgateway's\b/,
	/\bthe domain\b/,
	/\bthe backend\b/,
	/\bthe spike\b/,
];

/**
 * Every hand-written file in the package, `src/` AND `test/`.
 *
 * **This guard scanned `src/` only, and a stale `@cm/typespec-hono` sat in a ported test file
 * until an unrelated assertion failed on it.** A test naming a foreign package is exactly as wrong as
 * source doing so: it is the same claim about the same codebase, and it is the file a reader reaches
 * for when they want to know what a rule means.
 *
 * Generated output under `.out/` is excluded. It is not hand-written, and its content is graded by
 * `vocabulary.test.ts` against a different rule.
 */
function handWrittenFiles(): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			// `.out*`, not `.out`. The per-suite sweep directories (`.out-vocabulary`, ...) hold
			// generated files too, and treating those as hand-written would grade the emitter's output
			// against a rule written for prose.
			if (entry.startsWith(".out") || entry === "node_modules" || entry === "dist") continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith(".ts") || entry.endsWith(".tsp")) found.push(full);
		}
	};
	walk(src);
	walk(join(packageRoot, "test"));
	// This file names every forbidden term by definition; scanning it would make the rule unsatisfiable.
	return found.filter((file) => !file.endsWith("provenance.test.ts"));
}

describe("the package names no codebase but its own", () => {
	const files = handWrittenFiles();

	it("has source to inspect at all", () => {
		// Without this the arm below passes the day the glob stops matching.
		expect(files.length).toBeGreaterThanOrEqual(15);
	});

	it("mentions no term belonging to the codebase it was extracted from", () => {
		const offenders: string[] = [];
		for (const file of files) {
			const lines = readFileSync(file, "utf8").split("\n");
			lines.forEach((line, index) => {
				for (const term of FOREIGN) {
					/**
					 * One deliberate exception, and it is stated as a SHAPE rather than a line number: a
					 * docblock may name a term while recording that the behaviour naming it was removed.
					 * Losing that history to satisfy this rule would be the worse trade, the reason a rule
					 * exists is the part that stops it being reintroduced.
					 */
					if (/\bused to\b|\bwas removed\b|\bno longer\b/.test(line)) continue;
					if (term.test(line)) offenders.push(`${file}:${index + 1}: ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});

	it("keys no behaviour on a name the spec AUTHOR chose", () => {
		/**
		 * **The prose arm above would not have caught the defect that prompted this file.** A filter
		 * on a literal property name is code, not a comment, and it read as ordinary.
		 *
		 * The class, stated precisely: **`.kind` is TypeSpec's vocabulary and `.name` is the spec
		 * author's.** Branching on `type.kind === "Model"` is reading the language; branching on
		 * `parameter.name === "companyId"` is deciding that one word means something in every spec that
		 * uses it. The first is how an emitter is written. The second is a rule no document states.
		 *
		 * The exception is a name TypeSpec itself decides, `bytes`, `Record`, `never`, the empty name
		 * an anonymous model carries. That is a closed first-party set, not a list this package
		 * maintains, which is why it can be written down without becoming the thing it guards against.
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
 * **The emitter entry point uses nothing this package does not export.**
 *
 * **This is the only mechanical proof that the published API is sufficient to build an emitter
 * on.** `typespec-hono` is written against `api.ts` and cannot reach past it, the `exports` map
 * forbids a deep import, so if this package's own `$onEmit` quietly reaches into `zod.ts` or
 * `registry.ts`, it is doing something no consumer could, and the API looks complete while being
 * short by exactly that much.
 *
 * Asserted over every specifier the file names, so a new import cannot slip in unexamined.
 */
describe("the emitter is written against the published API", () => {
	const emitter = join(src, "emitter.ts");
	const source = readFileSync(emitter, "utf8");

	it("reaches into `typespec-http-zod` only through what it publishes", () => {
		/**
		 * **The proof that the library's public API is sufficient to build a server generator on.**
		 * The library's `exports` map makes a deep import impossible, so anything this file cannot do
		 * from the published surface is a gap in that surface, to be fixed there rather than worked
		 * around here.
		 */
		const specifiers = [...source.matchAll(/^import\s[^"']*from\s*"([^"]+)"/gm)].map(
			(match) => match[1] ?? "",
		);
		expect(specifiers.length).toBeGreaterThanOrEqual(3);
		const deepImport = specifiers.filter((specifier) =>
			/^typespec-http-zod\/(?!runtime$)/.test(specifier),
		);
		expect(deepImport).toEqual([]);
	});

	it("emits one file, and delegates everything else", () => {
		/**
		 * Not a style rule. This package's whole claim is that it runs the library and adds a server;
		 * an emitter that grew a second `emitFile` would be doing work the library should own, or
		 * duplicating work it already does.
		 */
		expect([...source.matchAll(/emitFile\(/g)].length).toBe(1);
		/**
		 * **The CLASS (one delegation, handed the emit context) not a literal call spelling.**
		 *
		 * This asserted `/emitHttpZod\(context\)/` and turned red the moment the call gained a second
		 * argument, while every property it exists to protect still held: still one delegation, still
		 * the whole library, still one `emitFile`. It accused the emitter of breaking a rule it had not
		 * broken, which is the failure mode a hand-spelled assertion has and a class assertion does not.
		 *
		 * What matters is that the library is invoked exactly once and receives the context. What it is
		 * additionally told (`defaultRuntimeModule`, or whatever a wrapper needs next) is this
		 * package's business and not a fact this test should be pinning.
		 */
		const delegations = [...source.matchAll(/emitHttpZod\(\s*(\w+)/g)];
		expect(delegations.length).toBe(1);
		expect(delegations[0]?.[1]).toBe("context");
	});
});
