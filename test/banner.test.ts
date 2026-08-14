import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "./support/compile-fixture.js";

/**
 * **`regenerate-hint` must reach EVERY generated file, including this package's own.**
 *
 * The option is the library's and its files honoured it, while `app.gen.ts` and `runtime.gen.ts` are
 * written here and carried their own banner. Measured on a clean install: a consumer set one option
 * and got it on three files out of five, which is worse than not offering it, because the two that
 * ignore it are the two a reader opens first.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

function bannersUnder(outDir: string): { file: string; second: string }[] {
	return readdirSync(outDir)
		.filter((name) => name.endsWith(".gen.ts"))
		.map((file) => ({
			file,
			second: readFileSync(join(outDir, file), "utf8").split("\n")[1] ?? "",
		}));
}

describe("the regeneration hint", () => {
	it("reaches every generated file this emitter is responsible for", async () => {
		const compiled = await compileFixture(join(here, "reference"), "service", {
			bare: true,
			outName: "banner-hint",
			extraOptions: { "regenerate-hint": "pnpm run generate:api" },
		});
		const banners = bannersUnder(compiled.outDir);
		// Non-vacuity: app.gen.ts, schemas.gen.ts and runtime.gen.ts at least.
		expect(banners.length).toBeGreaterThanOrEqual(3);
		const missing = banners.filter((b) => !b.second.includes("pnpm run generate:api"));
		expect(missing.map((b) => b.file)).toEqual([]);
	});

	it("leaves the generic line where a project states none", async () => {
		const compiled = await compileFixture(join(here, "reference"), "service", {
			bare: true,
			outName: "banner-none",
		});
		const banners = bannersUnder(compiled.outDir);
		expect(banners.length).toBeGreaterThanOrEqual(3);
		expect(banners.filter((b) => b.second.includes("Regenerate with:"))).toEqual([]);
	});
});
