import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/** **A header's name decides no import.** See `headers.tsp`. */

const here = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("response headers named after importable types", () => {
	it("compile under noUnusedLocals, importing only what is used", async () => {
		const compiled = await compileFixture(here, "headers", { outName: "headernames" });
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
		const config = join(compiled.outDir, "tsconfig.check.json");
		writeFileSync(
			config,
			JSON.stringify({
				compilerOptions: {
					target: "es2023",
					lib: ["es2023", "dom"],
					module: "nodenext",
					moduleResolution: "nodenext",
					strict: true,
					exactOptionalPropertyTypes: true,
					noUnusedLocals: true,
					noEmit: true,
					skipLibCheck: true,
					types: [],
				},
				include: ["./app.gen.ts"],
			}),
		);
		let output = "";
		try {
			execFileSync(join(packageRoot, "node_modules", ".bin", "tsc"), ["-p", config], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			const asExec = error as { stdout?: string; stderr?: string };
			output = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
		}
		expect(output).toBe("");
	}, 300_000);
});
