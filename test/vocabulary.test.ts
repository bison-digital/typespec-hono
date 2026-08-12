import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Every call in the generated Zod must be derivable from the document.**
 *
 * ⚠️ **This is the assertion the governing rule always claimed and did not have — twice.** "Nothing
 * in the runtime validator is unsayable in the document" sat in the original emitter's plan for its
 * entire life, cited constantly, never built. It was eventually built there; then this package was
 * extracted without it, and the README went on claiming the class was asserted rather than trusted.
 *
 * That is the worst arrangement available: a rule everybody cites, nothing checks, and which
 * therefore drifts exactly as far as attention lapses. It matters more now, not less —
 * `z.preprocess` is admitted for collection formats, and an unenforced rule with a fresh exception
 * is how a dialect starts.
 *
 * **The class, not a list of members.** Anything that computes rather than describes is refused,
 * with one carve-out, stated as a SHAPE a machine can check rather than as a file name.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** Zod calls that enforce or rewrite something JSON Schema cannot state. */
const NOT_DERIVABLE = /\.(refine|superRefine|transform|catch|pipe|brand)\(/g;

/**
 * The ONE permitted `z.preprocess`, written as the only shape it may take.
 *
 * OpenAPI's `style` says a list was flattened into one value with a delimiter; this undoes exactly
 * that, before validation, so the document's own constraints still run. A `preprocess` doing anything
 * else — coercing, defaulting, renaming — is refused, because the document does not say it.
 */
const DELIMITER_SPLIT =
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? raw\.split\("(?:[^"\\]|\\.)*"\) : raw\), /g;

/** Emitted output, wherever a suite has produced it. */
function emittedFiles(): string[] {
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
	walk(join(packageRoot, "test"));
	return found;
}

describe("the generated validator says only what the document can say", () => {
	const files = emittedFiles();

	it("has emitted output to inspect at all", () => {
		// Without this the whole file passes the day the suites stop writing `.out/`.
		expect(files.length).toBeGreaterThanOrEqual(20);
	});

	it("has generated SERVERS to inspect, not only validators", () => {
		/**
		 * ⚠️ **The arms below would pass on validators alone.** This package's own artefact is
		 * `app.gen.ts`, and it is the one that could acquire a non-derivable call — a hand-rolled
		 * coercion in a handler, a `.transform()` smuggled into a response. Checking only what the
		 * library wrote would leave this package's output ungraded by its own rule.
		 */
		expect(files.filter((file) => file.endsWith("app.gen.ts")).length).toBeGreaterThanOrEqual(10);
	});

	it("uses no Zod call that enforces something the document cannot state", () => {
		/**
		 * Empty, not a count. An allowance that survives the thing it allowed has stopped guarding
		 * anything — which is why the original wrote this as a number first: reaching zero had to fail
		 * here rather than pass quietly.
		 */
		const offenders = files.flatMap((file) => {
			const source = readFileSync(file, "utf8");
			return [...source.matchAll(NOT_DERIVABLE)].map((match) => `${match[1]} in ${file}`);
		});
		expect(offenders).toEqual([]);
	});

	it("permits `z.preprocess` only as a delimiter split", () => {
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			const all = (source.match(/z\.preprocess\(/g) ?? []).length;
			const splits = (source.match(DELIMITER_SPLIT) ?? []).length;
			expect(all, `a non-split z.preprocess in ${file}`).toBe(splits);
		}
	});

	it("finds the delimiter splits it is meant to permit", () => {
		// Paired with the arm above, which passes trivially if the emitter stops emitting any.
		const splits = files.reduce(
			(total, file) => total + (readFileSync(file, "utf8").match(DELIMITER_SPLIT) ?? []).length,
			0,
		);
		expect(splits).toBeGreaterThanOrEqual(5);
	});

	it("declares no schema of its own in the server it generates", () => {
		/**
		 * ⚠️ **The split's load-bearing property, asserted here as well as in the reference suite.**
		 * Every validator `app.gen.ts` names was declared by `typespec-http-zod`. If this package ever
		 * declares one, two emitters are minting identifiers and agreeing by coincidence — which is the
		 * coupling the split exists to remove.
		 */
		const servers = files.filter((file) => file.endsWith("app.gen.ts"));
		const offenders = servers.filter((file) =>
			/^export const \w+(Schema|Path|Query|Header|Body|Response|Responses) = /m.test(
				readFileSync(file, "utf8"),
			),
		);
		expect(offenders).toEqual([]);
	});

	it("imports only frameworks, its own siblings, and the configured runtime module", () => {
		/**
		 * ⚠️ **The dependency points one way, and nothing else enforced it.** The whole wiring design
		 * turns on the application importing the generated file, implementing what it declares, and
		 * passing it in. The rejected alternative — the generated file importing the app's handlers —
		 * reads better on day one and fails by generation three, because an operation REMOVED from the
		 * spec just drops its import and leaves an orphan compiling forever.
		 */
		const servers = files.filter((file) => file.endsWith("app.gen.ts"));
		const allowed = (specifier: string): boolean =>
			specifier === "hono" ||
			specifier === "zod" ||
			specifier === "@hono/zod-validator" ||
			/^\.\/[\w.-]+\.gen\.js$/.test(specifier) ||
			// Whatever the consumer pointed `runtime-module` at is theirs by definition.
			/^(\.\.?\/)+.*runtime[\w.-]*\.js$/.test(specifier) ||
			specifier === "typespec-hono/runtime";
		const strays = servers.flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)]
				.map((match) => match[1] ?? "")
				.filter((specifier) => !allowed(specifier))
				.map((specifier) => `${specifier} in ${file}`),
		);
		expect(strays).toEqual([]);
	});

	it("ships no decorator of its own for a spec to depend on", () => {
		/**
		 * ⚠️ **The other half, and without it the arm above can be satisfied by a spec that simply
		 * stopped using the decorator.** Four existed in this emitter's ancestor — `@trimmed`, `@loose`,
		 * `@externalValues`, `@refine` — and each let a spec state something `@typespec/openapi3` could
		 * not publish, so the emitted validator enforced a rule no caller reading the contract could see.
		 *
		 * Asserted against the package's own TypeSpec entry point, because that is the only thing a
		 * consumer's `import` can reach. A `$decorators` export there is a second contract, whatever it
		 * happens to contain.
		 */
		const entry = readFileSync(join(packageRoot, "lib", "main.tsp"), "utf8");
		expect(entry).not.toMatch(/^\s*import\s+"\.\/decorators\.tsp"/m);
		// The DECLARATION, not the word: the docblock beside it explains why there is none, and a
		// prose match would make this arm impossible to satisfy while explaining itself.
		expect(readFileSync(join(packageRoot, "src", "tsp-index.ts"), "utf8")).not.toMatch(
			/^\s*(?:export\s+)?const\s+\$decorators\b/m,
		);
		expect(existsSync(join(packageRoot, "lib", "decorators.tsp"))).toBe(false);
		// `$lib` carries no `state` key either: state is what a decorator writes into.
		expect(readFileSync(join(packageRoot, "src", "lib.ts"), "utf8")).not.toMatch(/^\s*state:/m);
	});
});
