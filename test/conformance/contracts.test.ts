import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
 * **The contract types and the handler types state ONE input and ONE result per operation.**
 *
 * `typespec-http-zod` writes `requests.gen.ts` for a framework-free consumer - a backend reached over
 * a service binding, a client - and this package writes `app.gen.ts` for the server. They were
 * compared by nothing, and drifted apart on every axis this suite checks: the contract merged bodies
 * the handler names, admitted an explicit `undefined` the server refuses, omitted operations, and
 * stated one success body where the handler returns several. Each was found by a consumer, one at a
 * time.
 *
 * So, over every scenario in the corpus and every depth fixture, one compiled consumer per scenario
 * asserts the directions a consumer actually relies on:
 *
 * - **the same operations**: `keyof Operations` is `keyof WireInputs` is `keyof WireResults`;
 * - **a gateway can forward what it received**: each handler input is assignable to `WireInputs[op]`,
 *   and declares the same keys, so a contract wider than the input cannot pass on assignability alone;
 * - **a handler can return what a backend returned**: each `WireResults[op]` is assignable to the
 *   handler's result, and every member pairs with one of the other's by its status and media type, in
 *   both directions - so a range that no longer excludes a code declared beside it, or a member one
 *   side lacks, fails rather than passing on assignability;
 * - **one byte stream**: the runtime's `ByteStream` is the contract's.
 *
 * Directional where the two describe different sides of one value - the contract is what a caller
 * supplies (`z.input`), the input what a handler receives (`z.infer`) - and exact where they do not.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const outRoot = join(here, ".out-contracts");

let compiled: readonly CompiledScenario[] = [];

beforeAll(async () => {
	const collected: CompiledScenario[] = [];
	for (const scenario of [...discoverScenarios(), ...depthSources()]) {
		collected.push(await compileScenario(scenario, outRoot));
	}
	compiled = collected;
}, 900_000);

function consumerFor(serverDir: string): string {
	const requests = readFileSync(join(serverDir, "requests.gen.ts"), "utf8");
	// Whether the contract declares a byte stream at all: a declaration at the top of the file.
	const streams = /^export interface ByteStream /m.test(requests);
	return `import type { Operations } from "./app.gen.js";
import type { WireInputs, WireResults${streams ? ", ByteStream as ContractByteStream" : ""} } from "./requests.gen.js";
${streams ? 'import type { ByteStream as RuntimeByteStream } from "./runtime.gen.js";\n' : ""}
type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type MustHold<T extends true> = T;
type Ops = Operations<unknown>;
type InputOf<K extends keyof Ops> = Parameters<Ops[K]>[1];
type ResultOf<K extends keyof Ops> = Awaited<ReturnType<Ops[K]>>;
type DeclaredKeys<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: 0 };
/** The keys whose entry is not \`true\`, so a failure names the operations it fails on. */
type Failing<M> = { [K in keyof M]: M[K] extends true ? never : K }[keyof M];
type Facts<M> = Pick<M, ("status" | "contentType") & keyof M>;
/** Every member of A has a member of B with the same status set and media type. */
type Paired<A, B> = [A] extends [never]
	? true
	: (A extends unknown ? Identical<Facts<A>, Facts<Extract<B, Facts<A>>>> : never) extends true
		? true
		: false;

export type SameOperations = MustHold<Identical<keyof Ops, keyof WireInputs>>;
export type SameResults = MustHold<Identical<keyof Ops, keyof WireResults>>;

type Forwards = { [K in keyof Ops]: K extends keyof WireInputs ? (InputOf<K> extends WireInputs[K] ? true : false) : false };
export type InputsForward = MustHold<Identical<Failing<Forwards>, never>>;

type SameKeys = { [K in keyof Ops]: K extends keyof WireInputs ? Identical<DeclaredKeys<InputOf<K>>, DeclaredKeys<WireInputs[K]>> : false };
export type InputsKeyedAlike = MustHold<Identical<Failing<SameKeys>, never>>;

type Returns = { [K in keyof Ops]: K extends keyof WireResults ? (WireResults[K] extends ResultOf<K> ? true : false) : false };
export type ResultsReturn = MustHold<Identical<Failing<Returns>, never>>;

type Members = { [K in keyof Ops]: K extends keyof WireResults ? (Paired<WireResults[K], ResultOf<K>> extends true ? Paired<ResultOf<K>, WireResults[K]> : false) : false };
export type ResultsPairMemberByMember = MustHold<Identical<Failing<Members>, never>>;
${streams ? "\nexport type OneByteStream = MustHold<Identical<ContractByteStream, RuntimeByteStream>>;\n" : ""}`;
}

function typecheck(serverDir: string): string {
	writeFileSync(join(serverDir, "agreement.consumer.ts"), consumerFor(serverDir));
	const config = join(serverDir, "tsconfig.agreement.json");
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
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			include: ["./agreement.consumer.ts"],
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
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
	}
}

describe("the contract types and the handler types agree, over the corpus", () => {
	it("agrees for every scenario the corpus declares", () => {
		const servers = compiled.filter(
			(entry) =>
				entry.failure === undefined &&
				existsSync(join(entry.serverDir, "app.gen.ts")) &&
				existsSync(join(entry.serverDir, "requests.gen.ts")),
		);
		// Non-vacuity: the corpus is sixty-odd scenarios, and a discovery that found none agrees.
		expect(servers.length).toBeGreaterThanOrEqual(55);
		const disagreements: string[] = [];
		for (const server of servers) {
			const output = typecheck(server.serverDir);
			if (output !== "") disagreements.push(`${server.scenario.name}\n${output}`);
		}
		expect(disagreements, disagreements.join("\n\n")).toEqual([]);
	});
});
