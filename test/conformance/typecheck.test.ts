import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
	compileScenario,
	depthSources,
	discoverScenarios,
	packageRoot,
	type CompiledScenario,
} from "./corpus.js";

/**
 * **Every server the corpus emits compiles, not only the ones this package's fixtures describe.**
 *
 * `compiles.test.ts` compiles the fixtures written here. The corpus is where the shapes nobody here
 * thought of live - a status range, a `default` arm, SSE, XML beside JSON, a model served as an image -
 * and a generated server that does not compile is the worst failure available to an emitter, because
 * every other signal says it worked. Nothing had compiled the corpus's servers.
 *
 * **`app.gen.ts` and `runtime.gen.ts` only**, which are this package's artefacts. `wire-contract.gen.ts`
 * is the library's, and the corpus harness points `contracts-package` at `vocabularies.gen.js`, which
 * cannot satisfy it - the trap the library's own harness closed with a barrel, and a harness concern
 * rather than one of this emitter's.
 *
 * **One `tsc` per scenario.** A single invocation over many reports a capped subset, and a truncated
 * output looks exactly like a clean one.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const outRoot = join(here, ".out-typecheck");

/**
 * Scenarios whose emitted server does NOT compile, each for a reason recorded here. Asserted
 * EXACTLY, so a fix has to remove its entry and a new failure cannot be absorbed.
 *
 * **Empty, and it was not.** Six scenarios were pinned here on two REQUEST-side defects, both fixed
 * in the same release as the response work that first compiled the corpus at all:
 *
 * - a scalar, enum or union JSON request body was SPREAD into the handler's input (`TS2698`). A body
 *   that is not a model has no properties to merge, and is now named, as an indexed body already was.
 *   A `text/plain` body was worse than that: it emitted no body middleware, so it compiled and the
 *   handler was called with an empty input;
 * - a recursive model's schema is emitted with a getter, whose missing return type made `z.infer`
 *   collapse to `unknown` in any schema WRAPPING it (`TS2322`).
 *
 * `special-words` and `type/union/discriminated` are not here because their compile fails before a
 * server is written (openapi3 crashes on the first, the library refuses the second), which
 * `routes.test.ts` records.
 */
const KNOWN_FAILURES: Readonly<Record<string, readonly string[]>> = {};

let compiled: readonly CompiledScenario[] = [];

beforeAll(async () => {
	const collected: CompiledScenario[] = [];
	for (const scenario of [...discoverScenarios(), ...depthSources()]) {
		collected.push(await compileScenario(scenario, outRoot));
	}
	compiled = collected;
}, 900_000);

/** `tsc` over one scenario's server, returning only what it said about this package's files. */
function typecheck(serverDir: string): string {
	const config = join(serverDir, "tsconfig.typecheck.json");
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
				noUncheckedIndexedAccess: true,
				noImplicitReturns: true,
				noUnusedLocals: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			include: ["./app.gen.ts", "./runtime.gen.ts"],
		}),
	);
	try {
		execFileSync(join(packageRoot, "node_modules", ".bin", "tsc"), ["-p", config], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return "";
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`
			.split("\n")
			.filter((line) => /(app|runtime)\.gen\.ts\(/.test(line))
			.join("\n");
	}
}

describe("every server the corpus emits compiles", () => {
	it("compiles every scenario the corpus declares, or names why not", () => {
		const servers = compiled.filter(
			(entry) => entry.failure === undefined && existsSync(join(entry.serverDir, "app.gen.ts")),
		);
		// Non-vacuity: the corpus is sixty-odd scenarios, and a discovery that found none agrees with nothing.
		expect(servers.length).toBeGreaterThanOrEqual(55);
		const failing: Record<string, readonly string[]> = {};
		const detail: string[] = [];
		for (const server of servers) {
			const output = typecheck(server.serverDir);
			if (output === "") continue;
			failing[server.scenario.name] = [
				...new Set([...output.matchAll(/error (TS\d+)/g)].map((match) => match[1] ?? "")),
			].toSorted();
			detail.push(`${server.scenario.name}\n${output}`);
		}
		expect(failing, detail.join("\n\n")).toEqual(KNOWN_FAILURES);
	});
});
