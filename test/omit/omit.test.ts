import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **A service whose server this project does not want.**
 *
 * See `two.tsp`. The validators and types are still emitted, because those are why the service is in
 * the program at all; only `app.gen.ts` is withheld.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("a service configured not to emit a server", () => {
	it("emits no app.gen.ts for it, and still emits one for the others", async () => {
		const compiled = await compileFixture(here, "two", {
			outName: "omit",
			extraOptions: { services: { Unserved: { "emit-server": false } } },
		});
		// Per-service output directories, because the program declares more than one service.
		const served = join(compiled.outDir, "Served");
		const unserved = join(compiled.outDir, "Unserved");
		expect(existsSync(join(served, "app.gen.ts")), "the served service lost its server").toBe(true);
		expect(existsSync(join(unserved, "app.gen.ts")), "the unserved service kept one").toBe(false);
	});

	it("still emits the validators for it, which is why it is in the program", async () => {
		const compiled = await compileFixture(here, "two", {
			outName: "omit-schemas",
			extraOptions: { services: { Unserved: { "emit-server": false } } },
		});
		const unserved = readdirSync(join(compiled.outDir, "Unserved"));
		expect(unserved).toContain("schemas.gen.ts");
	});

	it("emits a server for every service when nothing says otherwise", async () => {
		const compiled = await compileFixture(here, "two", { outName: "omit-default" });
		for (const service of ["Served", "Unserved"]) {
			expect(existsSync(join(compiled.outDir, service, "app.gen.ts")), service).toBe(true);
		}
	});
});
