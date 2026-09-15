import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **What a handler CANNOT return, each proven by a compile that fails.**
 *
 * The result type is the union of the responses the document declares, so a status it does not
 * declare, a body belonging to another status, a missing required header and a body on a response
 * that has none are all compile errors in the application - not a 500 at run time, and not a response
 * the contract does not permit. Two more belong to `registerRoutes`: a caller context the handler did
 * not ask for, and a handler for an operation the document no longer declares.
 *
 * **One `tsc` per case, beside a control that must compile.** A single compile over every case would
 * report whichever errors it reached first, and a case that stopped failing would hide among the ones
 * that still do. The control is the same consumer with nothing wrong in it: without it, a generated
 * file that did not compile would fail every case for a reason none of them is about.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let outDir = "";

beforeAll(async () => {
	const compiled = await compileFixture(here, "envelope", { outName: "envelope-refusals" });
	outDir = compiled.outDir;
}, 300_000);

/**
 * The handlers of a consumer that does nothing wrong. A case replaces exactly one of them.
 *
 * **`as const` on each result, and no `satisfies`**, so every refusal below is `registerRoutes`'s own
 * rather than an annotation's. A result written without either widens `status: 201` to `number`,
 * which no declared response admits: an application writes `satisfies Operations<Caller>` or returns
 * `as const`, and `test/wiring/consumer.fixture.ts` is the `satisfies` form.
 */
const VALID: Readonly<Record<string, string>> = {
	create: `() => ({ status: 201, body: item }) as const`,
	tagged: `() => ({ status: 200, body: item, headers: { "x-correlation-id": "c-1" } }) as const`,
	plain: `() => ({ status: 200, body: item }) as const`,
	throttle: `() => ({ status: 429, body: { title: "slow" } }) as const`,
	text: `() => ({ status: 200, body: "text" }) as const`,
	xml: `() => ({ status: 200, body: "<item/>" }) as const`,
	blob: `() => ({ status: 200, body: new Uint8Array([1]) }) as const`,
	either: `() => ({ status: 200, contentType: "application/json", body: item }) as const`,
	remove: `() => ({ status: 204 }) as const`,
};

function consumer(overrides: Readonly<Record<string, string>>): string {
	const handlers = { ...VALID, ...overrides };
	return `import { Hono } from "hono";
import { registerRoutes, type Operations } from "./app.gen.js";
import type { AppEnv, RouteDeps } from "./runtime.gen.js";

interface Caller { readonly accountId: string }
const item = { id: "1", label: "one" };

const deps: RouteDeps<AppEnv, Caller> = {
	authorize: () => async (_c, next) => { await next(); },
	context: () => ({ accountId: "a" }),
	noContext: (c) => c.json({}, 401),
	notAcceptable: (c) => c.json({}, 406),
	invalid: (result, c) => (result.success ? undefined : c.json({}, 400)),
};

const handlers = {
${Object.entries(handlers)
	.map(([name, handler]) => `\t${name}: ${handler},`)
	.join("\n")}
};

export const routes = registerRoutes(new Hono<AppEnv>(), () => handlers, deps);
export type Checked = Operations<Caller>;
`;
}

function compile(
	name: string,
	source: string,
): { readonly failed: boolean; readonly output: string } {
	const dir = join(outDir, "refusals", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "consumer.ts"),
		source
			.replaceAll("./app.gen.js", "../../app.gen.js")
			.replaceAll("./runtime.gen.js", "../../runtime.gen.js"),
	);
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "es2023",
				lib: ["es2023", "dom"],
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				exactOptionalPropertyTypes: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			include: ["./consumer.ts"],
		}),
	);
	try {
		execFileSync(
			join(here, "..", "..", "node_modules", ".bin", "tsc"),
			["-p", join(dir, "tsconfig.json")],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		return { failed: false, output: "" };
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return { failed: true, output: `${asExec.stdout ?? ""}${asExec.stderr ?? ""}` };
	}
}

describe("a consumer with nothing wrong in it", () => {
	it("compiles, so every case below fails for its own reason", () => {
		const { failed, output } = compile("control", consumer({}));
		expect(output.trim(), output).toBe("");
		expect(failed).toBe(false);
	});
});

describe("a handler cannot return what the document does not declare", () => {
	it.each([
		[
			"a status the operation does not declare",
			{ plain: `() => ({ status: 500, body: item }) as const` },
		],
		[
			"a body that belongs to another status",
			{ throttle: `() => ({ status: 429, body: item }) as const` },
		],
		[
			"the default arm's body on a status its range governs",
			{ throttle: `() => ({ status: 404, body: { reason: "gone" } }) as const` },
		],
		[
			"a body on a response that has none",
			{ remove: `() => ({ status: 204, body: item }) as const` },
		],
		[
			"a response without its required header",
			{ tagged: `() => ({ status: 200, body: item }) as const` },
		],
		[
			"a media type the status does not offer",
			{ either: `() => ({ status: 200, contentType: "text/html", body: item }) as const` },
		],
	] as const)("refuses %s", (what, override) => {
		const { failed, output } = compile(what.replaceAll(/[^a-z]+/g, "-"), consumer(override));
		expect(failed, "compiled, so the result type admitted it").toBe(true);
		// The error is in the consumer, not in the generated file the control proved compiles.
		expect(output).toMatch(/consumer\.ts\(/);
		expect(output).not.toMatch(/app\.gen\.ts\(/);
	});
});

describe("registerRoutes refuses handlers that disagree with the application", () => {
	it("refuses a handler asking for a richer caller context than deps.context establishes", () => {
		const { failed, output } = compile(
			"context",
			consumer({
				plain: `(ctx: Caller & { readonly scopes: readonly string[] }) => ({ status: 200, body: { id: ctx.scopes.join(), label: "l" } }) as const`,
			}),
		);
		expect(failed, "compiled, so the context type is not checked").toBe(true);
		expect(output).toMatch(/consumer\.ts\(/);
	});

	it("refuses a handler for an operation the document does not declare", () => {
		const { failed, output } = compile(
			"surplus",
			consumer({ removedFromTheSpec: `() => ({ status: 200, body: item }) as const` }),
		);
		expect(failed, "compiled, so a removed operation would go unnoticed").toBe(true);
		expect(output).toMatch(/consumer\.ts\(/);
	});
});
