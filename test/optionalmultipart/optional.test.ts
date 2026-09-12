import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **An optional multipart body is NAMED, and a required one is still MERGED.** See `optional.tsp`.
 *
 * The claim is made here, at the boundary, rather than inferred from the library publishing the
 * right `bodyProperty`. That is the lesson `test/openmodel/` exists for: the library went green
 * once while the signature a consumer writes against was still wrong, because this package derives
 * its handler input from `z.infer` rather than from the library's contract types.
 *
 * The compile arm below is the one that decides, and it compiles `app.gen.ts` itself, which is
 * where the `TS2345` lived.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "optional", { outName: "optionalmultipart" });
}, 300_000);

/** `tsc` over the generated directory plus one hand-written consumer file, then take it away. */
function withConsumer(source: string): string {
	const consumer = join(compiled.outDir, "consumer.ts");
	const config = join(compiled.outDir, "tsconfig.consumer.json");
	writeFileSync(consumer, source);
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
	} finally {
		rmSync(consumer, { force: true });
	}
}

describe("an optional multipart body", () => {
	it("is named on the handler input, and the required one beside it is still merged", () => {
		const output = withConsumer(`
import type { Operations } from "./app.gen.js";

// A merge cannot say absent, so the parts are reachable only through the name.
export const upload: Operations["upload"] = async (_ctx, input) => {
	const named: string = input.body?.file.name ?? "none";
	const pages: number = input.body?.pages.length ?? 0;
	void [named, pages];
};

// The control: a REQUIRED multipart body is still MERGED, exactly as test/filepart/ asserts.
export const required: Operations["required"] = async (_ctx, input) => {
	const merged: string = input.file.name;
	void [merged, input.pages.length];
};

// An anonymous parts model still gets a declared name to hang the body off.
export const anonymous: Operations["anonymous"] = async (_ctx, input) => {
	const note: string = input.body?.note ?? "none";
	void note;
};
`);
		expect(output, output).toBe("");
	});

	it("spreads the required body and assigns the optional one at the generated call site", () => {
		const source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
		// Not a claim that the text looks right: the arm above already compiled it. This says the
		// two operations took DIFFERENT branches, which a single-operation fixture could not show.
		expect(source).toContain('body: c.req.valid("json")');
		expect(source).toContain('...c.req.valid("json")');
	});
});
