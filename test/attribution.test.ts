import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **Nothing in this package credits a tool for the work.**
 *
 * No assistant, model or vendor is named anywhere a reader can reach: not in the source, not in the
 * documentation, not in a commit message, not in the authorship of a commit. This is a standing rule
 * across these projects rather than a preference about this one, and it applies to everything that
 * ships or is published — source, README, CHANGELOG, release notes, tags and git metadata alike.
 *
 * ⚠️ **Asserted rather than reviewed, because the failure mode is a default.** Several tools append a
 * trailer or a signature line unless told not to, so the absence of one is a thing that has to be
 * maintained on every commit forever. A rule enforced by attention is a rule that survives exactly as
 * long as attention does; this is cheap and does not get tired.
 *
 * ⚠️ **Commit messages are checked as well as files, and that is the half that would otherwise rot.**
 * A file is reviewed when it changes. A commit message is written once, is never looked at again, and
 * cannot be corrected after it is pushed without rewriting history — so it is precisely where an
 * unwanted line would survive.
 *
 * **The class, not a list.** Matching is case-insensitive over vendor and product names plus the
 * trailer forms these tools emit, so a new tool with a familiar shape is caught by the shape.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * ⚠️ **Word-boundary anchored, and `AI` deliberately requires punctuation around it.** A bare
 * case-insensitive `/ai/` matches `contains`, `available`, `fail`, `domain` and `explain`; a rule that
 * cries wolf on ordinary prose gets suppressed, and a suppressed rule guards nothing. The forms that
 * actually appear in an attribution are what is matched.
 */
const ATTRIBUTION = [
	/\bclaude\b/i,
	/\banthropic\b/i,
	/\bcopilot\b/i,
	/\bchatgpt\b/i,
	/\bopenai\b/i,
	/\bgemini\b/i,
	/\bcursor\.(?:sh|com)\b/i,
	/\bco-authored-by\b/i,
	/\bgenerated with\s+\S*(?:claude|ai|llm)\b/i,
	/\bAI[- ](?:generated|assisted|authored|written)\b/i,
	/\bwritten by (?:an? )?(?:AI|LLM|assistant|bot)\b/i,
	/\bassisted by (?:an? )?(?:AI|LLM)\b/i,
	/🤖/u,
];

function offendersIn(label: string, text: string): string[] {
	return ATTRIBUTION.flatMap((pattern) => {
		const match = pattern.exec(text);
		return match === null ? [] : [`${label}: ${match[0]}`];
	});
}

function git(...args: readonly string[]): string {
	return execFileSync("git", args, {
		cwd: packageRoot,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
}

describe("the package credits no tool for the work", () => {
	const files = git("ls-files")
		.split("\n")
		.filter((name) => name !== "");

	it("has files and history to inspect at all", () => {
		// Without this the whole file passes the day `git ls-files` returns nothing.
		expect(files.length).toBeGreaterThanOrEqual(20);
		expect(git("rev-list", "--count", "HEAD").trim()).not.toBe("0");
	});

	it("names no assistant, model or vendor in any tracked file", () => {
		const offenders = files.flatMap((name) => {
			// This file names every forbidden term by definition; scanning it makes the rule unsatisfiable.
			if (name === "test/attribution.test.ts") return [];
			let source: string;
			try {
				source = readFileSync(`${packageRoot}/${name}`, "utf8");
			} catch {
				return [];
			}
			return offendersIn(name, source);
		});
		expect(offenders).toEqual([]);
	});

	it("names none in any commit message, over the whole history", () => {
		/**
		 * ⚠️ **`--all`, so a branch or tag cannot carry one in.** The check is worth nothing if it only
		 * covers what `main` happens to point at today.
		 */
		const messages = git("log", "--all", "--format=%H%n%B%n%(trailers)");
		expect(offendersIn("commit message", messages)).toEqual([]);
	});

	it("attributes every commit to a person, in both the author and committer fields", () => {
		/**
		 * ⚠️ **Both fields, because they differ and only one of them is usually looked at.** A rebase or
		 * an amend by a tool rewrites the COMMITTER and leaves the author alone, so checking the author
		 * only would miss exactly the case that arises in practice.
		 */
		const identities = new Set(
			git("log", "--all", "--format=%an <%ae>%n%cn <%ce>")
				.split("\n")
				.filter((line) => line !== ""),
		);
		expect(identities.size).toBeGreaterThanOrEqual(1);
		expect([...identities].flatMap((who) => offendersIn("identity", who))).toEqual([]);
		// An empty or placeholder identity is the other way a commit ends up crediting nobody real.
		expect(
			[...identities].filter((who) => /^\s*<\s*>\s*$/.test(who) || who.includes("<>")),
		).toEqual([]);
	});
});
