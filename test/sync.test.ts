/**
 * **Every emitted schema parses SYNCHRONOUSLY, because the generated server now assumes it.**
 *
 * `safeParse` **throws** on a schema containing async logic - `Encountered Promise during synchronous
 * parse` - rather than returning a failed result. So switching the emitted body middleware and the
 * emitted `zValidator` calls off `safeParseAsync` turns "nothing this emitter writes is async" from a
 * remark into a load-bearing claim, and a claim the server would honour by throwing on a live request.
 *
 * It is true today for a reason rather than by luck: `vocabulary.test.ts` refuses `.transform(`,
 * `.pipe(`, `.superRefine(` and `.catch(` outright, and the single permitted `.refine(` is the
 * multipart file predicate, which is synchronous. **But that is an argument about emitted TEXT, and
 * this is a claim about emitted BEHAVIOUR** - the same gap that let `.optional()` and `Exact<>`
 * disagree for three releases. So the schemas are loaded and run.
 *
 * Graded over the whole corpus rather than the local fixtures, because the construct that would break
 * it is one no fixture here has thought to declare.
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { compileEmittedSet } from "./support/emitted-set.js";

interface Offender {
	readonly file: string;
	readonly schema: string;
	readonly detail: string;
}

const offenders: Offender[] = [];
const apps: string[] = [];
let schemasRun = 0;
let modulesRead = 0;

beforeAll(async () => {
	// One sweep for both halves: it compiles the whole corpus and costs about five seconds.
	const files = await compileEmittedSet("sync");
	for (const file of files.filter((name) => name.endsWith("app.gen.ts"))) {
		apps.push(readFileSync(file, "utf8"));
	}
	const schemaModules = files.filter((file) => file.endsWith("schemas.gen.ts"));
	for (const file of schemaModules) {
		let module: Record<string, unknown>;
		try {
			module = (await import(file)) as Record<string, unknown>;
		} catch {
			// Whether emitted output loads at all is `compiles.test.ts`'s question, not this one.
			continue;
		}
		modulesRead += 1;
		for (const [name, value] of Object.entries(module)) {
			if (value === null || typeof value !== "object") continue;
			if (typeof (value as ZodType).safeParse !== "function") continue;
			schemasRun += 1;
			/**
			 * **Two inputs, because a schema can reach async logic on either path.** A value that fails
			 * early may never touch the check that would have returned a promise, so a conformant-ish
			 * object is offered as well as the empty one. Neither needs to be accepted - only to be
			 * answered without throwing.
			 */
			for (const input of [undefined, {}, { probe: "value" }]) {
				try {
					(value as ZodType).safeParse(input);
				} catch (error) {
					offenders.push({
						file: file.slice(dirname(dirname(file)).length + 1),
						schema: name,
						detail: error instanceof Error ? error.message : String(error),
					});
				}
			}
		}
	}
}, 900_000);

describe("the emitted validators can be parsed synchronously", () => {
	it("read enough emitted output to be a claim at all", () => {
		// Floored on both axes: a sweep that stopped emitting, and one that emitted nothing runnable.
		expect(modulesRead).toBeGreaterThanOrEqual(40);
		expect(schemasRun).toBeGreaterThanOrEqual(400);
	});

	it("throws on none of them, which is what the emitted server relies on", () => {
		expect(offenders.map((o) => `${o.file} ${o.schema}: ${o.detail}`)).toEqual([]);
	});

	it("mounts every parameter validator on the synchronous path", () => {
		/**
		 * The behavioural arm above says the schemas CAN parse synchronously; this says the generated
		 * server actually asks them to. Both are needed - a server that kept calling `safeParseAsync`
		 * would pass the arm above while paying 2.6x per request for nothing.
		 */
		expect(apps.length).toBeGreaterThanOrEqual(30);
		const withValidators = apps.filter((source) => source.includes("zValidator("));
		expect(withValidators.length).toBeGreaterThanOrEqual(20);
		expect(withValidators.filter((source) => !source.includes("deps.invalid, SYNC)"))).toEqual([]);
		expect(apps.filter((source) => source.includes("safeParseAsync"))).toEqual([]);
	});
});
