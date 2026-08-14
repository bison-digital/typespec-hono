import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { compileEmittedSet } from "./support/emitted-set.js";

/**
 * **No generated file declares the same name twice, anywhere this emitter can reach.**
 *
 * Every declaration in generated output is named after something the document supplies -- an
 * operation id, a model name -- and nothing forced those names to be distinct. Two operations
 * resolving to one id emitted one declaration twice, and the file did not compile:
 * `TS2300: Duplicate identifier`, 36 of them on one corpus scenario, while `tsp compile` reported
 * success and wrote the file.
 *
 * **This is deliberately a SWEEP rather than a fixture.** The collision was found on a corpus
 * scenario nothing had ever compiled, and a fixture would only ever cover the shape somebody already
 * thought of. Every `.gen.ts` this package can produce is read, across every fixture and the whole
 * conformance corpus, and a repeated declaration is named with the file it is in.
 *
 * **It covers the library's files as well as this package's, on purpose.** `app.gen.ts` is named from
 * ids that `typespec-http-zod` mints, so the two halves fail together and are worth grading together.
 * A duplicate in either is a file a consumer cannot build.
 */

let files: string[];

beforeAll(async () => {
	files = await compileEmittedSet("uniqueness");
}, 900_000);

/** Every top-level declaration a generated file makes, by name. */
function declarationsIn(source: string): string[] {
	return [
		...source.matchAll(/^export (?:type|const|interface|function|class) ([A-Za-z_$][\w$]*)/gm),
	].map((match) => match[1] ?? "");
}

describe("generated output declares every name once", () => {
	it("has files to sweep at all", () => {
		// Without this the whole guard passes on the day the sweep compiles nothing.
		expect(files.length).toBeGreaterThanOrEqual(50);
	});

	it("reads declarations out of them, so the sweep is not vacuous", () => {
		const total = files.reduce(
			(sum, file) => sum + declarationsIn(readFileSync(file, "utf8")).length,
			0,
		);
		expect(total).toBeGreaterThanOrEqual(500);
	});

	it("never declares one name twice in a file", () => {
		const repeated: string[] = [];
		for (const file of files) {
			const declared = declarationsIn(readFileSync(file, "utf8"));
			const seen = new Set<string>();
			const twice = new Set<string>();
			for (const name of declared) {
				if (seen.has(name)) twice.add(name);
				seen.add(name);
			}
			for (const name of [...twice].toSorted()) {
				repeated.push(`${file.slice(file.lastIndexOf("/.out") + 1)}: ${name}`);
			}
		}
		expect(repeated.toSorted().slice(0, 20)).toEqual([]);
	});
});
