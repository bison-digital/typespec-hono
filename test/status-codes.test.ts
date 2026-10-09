import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTENTLESS_STATUS_CODES, STATUS_CODES } from "typespec-http-zod";
import { HONO_STATUS_TYPES } from "../src/app.js";

/**
 * **The status literals the generated `case` labels are written from, held equal to Hono's own.**
 *
 * A range arm is served by one `case` per literal, so the emitter carries Hono's status codes as
 * values. Hono declares them as types. A status Hono adds to `ClientErrorStatusCode` would otherwise
 * be typed as part of a `4XX` response and fall through every `case` to `UndeclaredStatusError` at run
 * time - a declared response refused by the server that declares it.
 *
 * **Read from the installed declaration file, never from this package**, so the expectation comes
 * from outside the code it grades. The codes are `typespec-http-zod`'s, which owns the one table every
 * emitter types a result from; the class names are this package's.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const declarations = readFileSync(
	join(here, "..", "node_modules", "hono", "dist", "types", "utils", "http-status.d.ts"),
	"utf8",
);

/**
 * The numeric literals of one exported union type in Hono's declaration file, following the aliases
 * it is built from - `RedirectStatusCode` names `DeprecatedStatusCode` for 305 and 306.
 */
function honoCodes(name: string): number[] {
	const declared = new RegExp(`export type ${name} = ([^;]+);`).exec(declarations)?.[1];
	if (declared === undefined) throw new Error(`hono declares no ${name}`);
	const members = declared.split("|").map((member) => member.trim());
	return members
		.flatMap((member) => (/^\d{3}$/.test(member) ? [Number(member)] : honoCodes(member)))
		.toSorted((a, b) => a - b);
}

describe("the emitter's status literals are Hono's", () => {
	it.each(
		([1, 2, 3, 4, 5] as const).map((digit) => ({
			type: HONO_STATUS_TYPES[digit],
			codes: STATUS_CODES[digit],
		})),
	)("$type", ({ type, codes }) => {
		const expected = honoCodes(type);
		// Non-vacuity: a regex that matched nothing would compare an empty list against itself.
		expect(expected.length).toBeGreaterThanOrEqual(4);
		expect([...codes].toSorted((a, b) => a - b)).toEqual(expected);
	});

	it("ContentlessStatusCode", () => {
		expect([...CONTENTLESS_STATUS_CODES].toSorted((a, b) => a - b)).toEqual(
			honoCodes("ContentlessStatusCode"),
		);
	});
});
