import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "./support/compile-fixture.js";

/**
 * **Every generated declaration is keyed on an operation id, so those ids have to be unique.**
 *
 * Found by compiling the conformance corpus for the first time. `routes` declares an interface
 * `Standard` in six namespaces, so `Standard_primitive` was emitted six times and the generated server
 * failed with 36 `TS2300: Duplicate identifier` while `tsp compile` reported success.
 *
 * **The document is not the problem, and my first fix assumed it was.** I implemented a refusal, on
 * the premise that OpenAPI forbids duplicate operation ids and openapi3 was writing an invalid
 * document. Measured on this fixture, that premise is false: openapi3 DEDUPLICATES, writing
 * `Standard_primitive` and `Standard_primitive_2`, and the document is valid. So the spec is
 * perfectly representable and refusing it would have rejected something the contract states
 * correctly, which is the same defect class as everything else found this week: filed as
 * unrepresentable, actually unimplemented.
 *
 * What is left is an invariant rather than a refusal. Where it has to hold is `typespec-http-zod`,
 * which mints the ids this emitter is handed; asserting it here is what makes a regression there
 * visible in the artefact that breaks.
 *
 * **The scenario hid because it is one of the two the corpus classifies as an `oracle` failure:**
 * openapi3 crashes on it, so there is no document to differentiate against and the differential skips
 * it, while the files are still written and still invalid. A scenario excluded from one oracle for a
 * good reason was excluded from every oracle by accident.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let source: string;

beforeAll(async () => {
	const compiled = await compileFixture(join(here, "reference"), "collisions", {
		outName: "collisions-ids",
	});
	source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
}, 300_000);

describe("operations whose names collide before the document disambiguates them", () => {
	it("declare each handler alias exactly once", () => {
		const declared = [...source.matchAll(/export type (\w+) = Operations\[/g)].map(
			(m) => m[1] ?? "",
		);
		// Non-vacuity: a reader matching nothing would compare an empty list against itself.
		expect(declared.length).toBeGreaterThanOrEqual(3);
		expect(declared).toEqual([...new Set(declared)]);
	});

	it("declare each operation on the interface exactly once", () => {
		const members = [...source.matchAll(/^\t(\w+)\(ctx: Ctx/gm)].map((m) => m[1] ?? "");
		expect(members.length).toBeGreaterThanOrEqual(3);
		expect(members).toEqual([...new Set(members)]);
	});
});
