import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **No two test files may compile into the same output directory.**
 *
 * **This is the failure that looks exactly like a flaky emitter, and it has now happened twice.**
 * Vitest runs test files in parallel. Two files compiling one fixture into one directory with
 * different options overwrite each other, so whichever finishes last decides what the other is
 * asserting against. The first occurrence made the same request answer 400, 200 and 204 across three
 * runs of an unchanged emitter. The second was still live when this guard was written:
 * in the sibling library, `emit.test.ts` and `reference/reference.test.ts` both compiled `service`
 * into one directory, and on a populated tree `emit.test.ts` failed with four `TS2305`s against a
 * `schemas.gen.ts` that a different suite had written under different options.
 *
 * **A comment warning about it was not enough**, `FixtureOptions.outName` already carries that
 * exact warning, and `wiring.test.ts` and `adopter.test.ts` already use it correctly. The rule was known, written
 * down, and applied inconsistently, which is what a guard is for and a docblock is not.
 *
 * **The class, not a list of members.** Every `compileFixture` call site in the package is read, its
 * destination derived the way `compileFixture` derives it, and any destination claimed by more than
 * one test file is named. Adding a suite that collides fails here rather than intermittently
 * somewhere else.
 */

const testRoot = fileURLToPath(new URL(".", import.meta.url));

function testFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith(".")) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) found.push(...testFiles(full));
		else if (entry.endsWith(".test.ts")) found.push(full);
	}
	return found;
}

/**
 * Every `compileFixture(dir, "name", { outName })` call in a source file, as the directory it lands
 * in, `outName` when given, the fixture's own name otherwise, mirroring `compileFixture` itself.
 */
function destinationsIn(source: string): string[] {
	const calls = [
		...source.matchAll(/compileFixture\(\s*[^,]+,\s*"([^"]+)"\s*(?:,\s*\{([^}]*)\})?/gs),
	];
	return calls.map((call) => {
		const name = call[1] ?? "";
		const outName = /outName:\s*"([^"]+)"/.exec(call[2] ?? "")?.[1];
		return outName ?? name;
	});
}

describe("test files do not race each other for an output directory", () => {
	const files = testFiles(testRoot);

	it("has test files to inspect at all", () => {
		// Without this the whole guard passes the day the discovery walk stops finding anything.
		expect(files.length).toBeGreaterThanOrEqual(10);
	});

	it("finds the compile call sites it is meant to be checking", () => {
		// And without this it passes the day the call shape changes and the regex stops matching.
		const total = files.reduce(
			(sum, file) => sum + destinationsIn(readFileSync(file, "utf8")).length,
			0,
		);
		expect(total).toBeGreaterThanOrEqual(5);
	});

	it("gives every test file a destination no other test file writes", () => {
		const owners = new Map<string, Set<string>>();
		for (const file of files) {
			for (const destination of destinationsIn(readFileSync(file, "utf8"))) {
				const set = owners.get(destination) ?? new Set<string>();
				set.add(file.slice(testRoot.length));
				owners.set(destination, set);
			}
		}
		const shared = [...owners]
			.filter(([, writers]) => writers.size > 1)
			.map(([destination, writers]) => `${destination} <- ${[...writers].toSorted().join(", ")}`)
			.toSorted();
		expect(shared).toEqual([]);
	});
});
