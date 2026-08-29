import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "./support/compile-fixture.js";

/**
 * **Every generated server compiles, not just the one a suite happened to point `tsc` at.**
 *
 * `adopter.test.ts` compiles the reference service and proves the default `runtime-module` resolves.
 * That is one shape of `app.gen.ts` out of everything this emitter can produce, and a whole class of
 * output had therefore never been through a compiler. Measured, and it was not hypothetical: an
 * operation declaring both a JSON and a form-encoded body emitted
 *
 * ```
 * app.gen.ts(202,22): error TS2345: Argument of type '"json"' is not assignable to parameter of type '"header"'.
 * ```
 *
 * because the dispatching middleware contributed no `Input` to Hono's chain, so `c.req.valid("json")`
 * in the handler referred to a target the types did not carry. The emitter reported no diagnostic,
 * the file was written, and every signal said it had worked. An emitter that emits code a consumer
 * cannot build is the worst shape of failure available to it.
 *
 * **Discovered, not listed.** Every `.tsp` fixture in this package is compiled and checked, so a
 * fixture added for a new construct is covered on the day it is added rather than when somebody
 * remembers. That is what makes this an arm about the CLASS rather than about four files.
 *
 * **Compiled `bare`**, which is the configuration the README's own example produces: no
 * `runtime-module`, so the emitted `runtime.gen.ts` is what the generated code resolves against,
 * exactly as a consumer's would.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

/** Every `.tsp` fixture this package owns, as `[directory, name]`, in a stable order. */
function fixtures(): readonly (readonly [dir: string, name: string])[] {
	const found: (readonly [string, string])[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir).toSorted()) {
			if (entry.startsWith(".") || entry === "node_modules") continue;
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else if (entry.endsWith(".tsp")) found.push([dir, entry.slice(0, -".tsp".length)]);
		}
	};
	walk(here);
	return found;
}

const FIXTURES = fixtures();

/** Where each fixture's own output lands. Its own root, so no other suite writes here. */
const outputRoot = join(here, ".out-compiles");

const compiled = new Map<string, string>();

beforeAll(async () => {
	for (const [dir, name] of FIXTURES) {
		const outDir = join(outputRoot, `${dir.slice(here.length).replaceAll("/", "_")}__${name}`);
		await compileFixture(dir, name, { bare: true, outDir });
		compiled.set(`${dir}/${name}`, outDir);
	}
}, 900_000);

/** `tsc` over one directory of generated files, returning everything it said. */
function typecheck(outDir: string): string {
	const config = join(outDir, "tsconfig.generated.json");
	writeFileSync(
		config,
		JSON.stringify({
			compilerOptions: {
				target: "es2023",
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				/**
				 * **Unused code is an ERROR here, and that is the point rather than tidiness.**
				 *
				 * A generated file has to pass the lint of whatever project it lands in, and an import
				 * written for a construct the service does not use fails it on day one. Two shipped:
				 * `zValidator` was imported unconditionally, so a service declaring no parameters at all
				 * (two bare `GET`s, which is where a health check starts) failed with
				 * `TS6133: 'zValidator' is declared but its value is never read`; and `z` was imported
				 * unconditionally, so a service whose every operation returns `void` failed the same way.
				 * Both from compiles that reported success.
				 *
				 * Without this flag `tsc` says nothing about either, which is why the arm was green while
				 * a consumer's first build was not.
				 */
				noUnusedLocals: true,
				noUnusedParameters: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			/**
			 * **Recursive, because a program declaring several services writes one directory each.**
			 * A flat include found nothing for such a fixture and `tsc` answered `TS18003`, so
			 * multi-service output had never been through a compiler at all.
			 */
			include: ["./**/*.gen.ts"],
		}),
	);
	try {
		execFileSync(
			join(here, "..", "node_modules", ".bin", "tsc"),
			["-p", config, "--ignoreConfig"],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		return "";
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
	}
}

describe("every generated server compiles", () => {
	it("has fixtures to compile at all", () => {
		// Without this the whole file passes the day the discovery walk stops finding anything.
		expect(FIXTURES.length).toBeGreaterThanOrEqual(5);
	});

	it.each(FIXTURES.map(([dir, name]) => [`${dir.slice(here.length)}/${name}`, dir, name] as const))(
		"%s",
		(_label, dir, name) => {
			const outDir = compiled.get(`${dir}/${name}`);
			expect(outDir, "fixture was not compiled").toBeDefined();
			const output = typecheck(outDir as string);
			expect(output, output).toBe("");
		},
		300_000,
	);

	/**
	 * **Non-vacuity, and it is specific rather than a count.**
	 *
	 * Compiling five servers that between them exercise one middleware would pass while proving
	 * nothing about the constructs that have actually broken. Each of these emits a distinct shape,
	 * and each was, at some point, emitted wrongly: a body dispatched on `Content-Type`, a `HEAD`
	 * registered under `GET`, a negotiated response, a raw binary read.
	 */
	it("the compiled set actually contains the constructs worth compiling", () => {
		/**
		 * Every emitted server, at whatever depth: a multi-service program writes one per service in a
		 * directory of its own, and reading only the top level silently skipped those.
		 */
		const servers = (root: string): string[] => {
			const found: string[] = [];
			const walk = (dir: string): void => {
				for (const entry of readdirSync(dir)) {
					const full = join(dir, entry);
					if (statSync(full).isDirectory()) walk(full);
					else if (entry === "app.gen.ts") found.push(readFileSync(full, "utf8"));
				}
			};
			walk(root);
			return found;
		};
		const sources = [...compiled.values()].flatMap(servers);
		const emitted = (token: string): number =>
			sources.filter((source) => source.includes(token)).length;
		/**
		 * A DISPATCHED body - several media types needing different readers - is now the same
		 * `validateBody` call as any other, given more than one branch. So the shape to count is the
		 * second branch, not a second function name: counting the name would pass for a fixture that
		 * declares one media type and prove nothing about dispatch.
		 */
		expect(
			sources.filter((source) => /validateBody\([^)]*, \[\n(\s*\[.*\],\n){2,}/.test(source)).length,
			"no fixture emits a dispatched request body",
		).toBeGreaterThan(0);
		expect(emitted("validateBody("), "no fixture emits a required request body").toBeGreaterThan(0);
		expect(
			emitted("validateOptionalBody("),
			"no fixture emits an optional request body",
		).toBeGreaterThan(0);
		expect(emitted("headOnly,"), "no fixture emits a guarded HEAD").toBeGreaterThan(0);
		expect(emitted("selectContentType("), "no fixture negotiates").toBeGreaterThan(0);
		expect(emitted("arrayBuffer()"), "no fixture reads a binary body").toBeGreaterThan(0);
	});
});
