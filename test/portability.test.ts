import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileEmittedSet } from "./support/emitted-set.js";

/**
 * **Nothing that ships names a path that exists on one machine.**
 *
 * ⚠️ **The emitted output is the half that matters, and it is the half no other arm reads for this.**
 * A generated file carrying `/Users/somebody/projects/…` compiles perfectly for the person who ran
 * the emitter and for nobody else — and it would be committed by the consumer, because generated
 * output is checked in. The `runtime-module` and `contracts-package` options both take a specifier
 * that lands verbatim in the output, so an absolute one is a single mis-set option away.
 *
 * ⚠️ **This is a companion to "every import resolves", not a subset of it.** An absolute specifier
 * RESOLVES, on the machine that wrote it — which is exactly why a resolution check cannot see it and
 * why portability needs an assertion of its own. Both properties are real and neither implies the
 * other.
 *
 * Home directories are matched by SHAPE rather than by this machine's own path, so the guard means the
 * same thing wherever it runs; keying it on `process.env.HOME` would pass on any other machine.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** An absolute path into somebody's checkout, in the forms the three platforms spell it. */
const MACHINE_PATHS = [
	/\/Users\/[^/\s"']+\//,
	/\/home\/[^/\s"']+\//,
	/\b[A-Za-z]:\\\\?Users\\\\?/,
	/\bfile:\/\/\/[A-Za-z]/,
];

function offendersIn(label: string, text: string): string[] {
	return MACHINE_PATHS.flatMap((pattern) => {
		const match = pattern.exec(text);
		return match === null ? [] : [`${label}: ${match[0]}`];
	});
}

let emitted: string[] = [];

beforeAll(async () => {
	emitted = await compileEmittedSet("portability");
}, 900_000);

describe("nothing this package ships names one machine's filesystem", () => {
	const tracked = execFileSync("git", ["ls-files"], { cwd: packageRoot, encoding: "utf8" })
		.split("\n")
		.filter((name) => name !== "");

	it("has files to inspect at all", () => {
		expect(tracked.length).toBeGreaterThanOrEqual(20);
	});

	it("carries no machine path in any tracked file", () => {
		const offenders = tracked.flatMap((name) => {
			// This file spells every forbidden shape by definition.
			if (name === "test/portability.test.ts") return [];
			try {
				return offendersIn(name, readFileSync(`${packageRoot}/${name}`, "utf8"));
			} catch {
				return [];
			}
		});
		expect(offenders).toEqual([]);
	});

	it("carries no machine path in anything the emitter GENERATES", () => {
		/**
		 * ⚠️ **The arm the review asked for, and the one with a real way to fail.** Tracked files are
		 * reviewed when they change; generated files are written fresh on every compile from whatever
		 * options the consumer set, and are then committed into the consumer's repository.
		 */
		expect(emitted.length).toBeGreaterThanOrEqual(20);
		const offenders = emitted.flatMap((file) =>
			offendersIn(file.slice(packageRoot.length), readFileSync(file, "utf8")),
		);
		expect(offenders).toEqual([]);
	});
});
