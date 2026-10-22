import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A summary is spec-authored text, and emitted source has to be able to carry it.** See
 * `summary.tsp`.
 *
 * The same class as a model named `as`: one declaration costing a whole emitted file rather than
 * one line. `objectKey` already answers this question for a property NAME, in one place, because
 * there were two sites and only one of them knew. This is the same question for a doc STRING, and
 * there are again two sites.
 *
 * The bar is not "it parses". Emitted output should read like output a person would have written,
 * so a comment terminator is escaped the way TypeScript escapes it and a multi-line description is
 * a multi-line block rather than one line with newlines inside it.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "summary", { outName: "summarytext" });
}, 300_000);

/** `tsc` over the generated directory alone. The emitted file is the subject here. */
function typecheckEmitted(): string {
	const config = join(compiled.outDir, "tsconfig.emitted.json");
	writeFileSync(
		config,
		JSON.stringify({
			compilerOptions: {
				target: "es2023",
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				exactOptionalPropertyTypes: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			include: ["./*.ts"],
		}),
	);
	try {
		execFileSync(join(here, "..", "..", "node_modules", ".bin", "tsc"), ["-p", config], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return "";
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
	}
}

describe("a summary that emitted source cannot carry verbatim", () => {
	it("does not stop the emitted file parsing", () => {
		const output = typecheckEmitted();
		expect(output, output).toBe("");
	});

	it("escapes the comment terminator rather than dropping the text", () => {
		const source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
		// The text survives, and it survives in the form TypeScript itself uses.
		expect(source).toContain("Returns a *\\/ b, which used to close the comment");
	});

	it("renders a multi-line description as a multi-line block, not one line", () => {
		const source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
		expect(source).toContain("\t * First line of the description.\n");
		expect(source).toContain("\t * Second line, which used to sit outside the comment.\n");
	});

	it("still renders an ordinary summary on one line, so nothing else moved", () => {
		const source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
		expect(source).toContain("\t/** An ordinary summary, so the arms below compare something */\n");
	});
});
