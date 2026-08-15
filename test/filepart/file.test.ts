import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A handler receives a multipart file part as a file, not as `unknown`.** See `file.tsp`.
 *
 * The library types the part; this asks whether that survives the separate walk which builds a
 * handler's input type. The open-model fix did not survive it - the library went green while the
 * signature a consumer writes against was still wrong - so the claim is made here, at the boundary,
 * rather than inferred from the library being correct.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "file", { outName: "filepart" });
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
				// The point of the structural spelling: no ambient library is needed to read a part.
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

describe("a handler can use a multipart file part", () => {
	it("reads a required, an optional and a repeated part with no cast", () => {
		const output = withConsumer(`
import type { Operations } from "./app.gen.js";

// A multipart body is merged into the input, not nested under a \`body\` key: the handler receives
// the parts and the headers as one object, exactly as the generated call site spreads them.
export const upload: Operations["upload"] = async (_ctx, input) => {
	const required: string = input.file.name;
	const optional: string = input.thumbnail?.name ?? "none";
	const repeated: string = input.pages.map((page) => page.name).join(",");
	const bytes: ArrayBuffer = await input.file.arrayBuffer();
	void [required, optional, repeated, input.file.type, bytes.byteLength];
};
`);
		expect(output, output).toBe("");
	});
});
