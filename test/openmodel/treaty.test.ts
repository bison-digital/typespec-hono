import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/** See `treaty.tsp`. Both claims are about the signature a consumer writes against. */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "treaty", { outName: "treaty" });
}, 300_000);

function withConsumer(source: string): string {
	const consumer = join(compiled.outDir, "consumer.ts");
	const config = join(compiled.outDir, "tsconfig.consumer.json");
	writeFileSync(consumer, source);
	writeFileSync(
		config,
		JSON.stringify({
			compilerOptions: {
				target: "es2023",
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				exactOptionalPropertyTypes: true,
				noEmit: true,
				skipLibCheck: true,
			},
			include: ["./*.ts"],
		}),
	);
	try {
		execFileSync(join(here, "..", "..", "node_modules", ".bin", "tsc"), ["-p", config], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return "";
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
	} finally {
		rmSync(consumer, { force: true });
	}
}

describe("every operation takes the same shape of arguments", () => {
	/**
	 * **A surface written once against `(ctx, input)` has to satisfy every operation**, including one
	 * that declares no input. TypeScript refuses a function with more parameters than its target, so
	 * a parameterless `(ctx)` signature made a uniform entrypoint unassignable - measured as
	 * `TS2322: Target signature provides too few arguments. Expected 2 or more, but got 1.`
	 */
	it("lets a uniform (ctx, input) implementation satisfy a parameterless operation", () => {
		const output = withConsumer(`
import type { Operations } from "./app.gen.js";

const uniform = <K extends keyof Operations>(name: K): Operations[K] =>
	((_ctx: unknown, _input: unknown) => {
		throw new Error(name);
	}) as Operations[K];

export const handlers: Operations = {
	listPages: uniform("listPages"),
	getPage: uniform("getPage"),
};
`);
		expect(output, output).toBe("");
	});

	/**
	 * The other half, and the reason this is not simply "add a parameter": an implementation written
	 * `(ctx) => ...` for an operation that takes nothing must keep compiling. Fewer parameters is
	 * always assignable, so adding the parameter is backward compatible - this arm is what proves it
	 * rather than asserting it.
	 */
	it("still accepts a handler written with no input parameter at all", () => {
		const output = withConsumer(`
import type { Operations } from "./app.gen.js";

export const listPages: Operations["listPages"] = () => ({ claims: {}, entries: [], tags: [] });
`);
		expect(output, output).toBe("");
	});
});

describe("a handler returns what the application already holds", () => {
	/**
	 * `readonly T[]` and `T[]` serialise to identical bytes, so `readonly` is a TypeScript variance
	 * property rather than a wire property - which `Produced<>` in the contract types already said,
	 * and the handler signature did not honour.
	 */
	it("accepts an immutable view as a response body", () => {
		const output = withConsumer(`
import type { Operations } from "./app.gen.js";

interface Entry {
	readonly id: string;
}

interface ImmutablePage {
	readonly claims: Readonly<Record<string, unknown>>;
	readonly entries: readonly Entry[];
	readonly tags: readonly string[];
}

const view: ImmutablePage = { claims: { a: 1 }, entries: [{ id: "a" }], tags: ["t"] };

export const listPages: Operations["listPages"] = () => view;
`);
		expect(output, output).toBe("");
	});

	it("accepts a response that omits an optional property", () => {
		const output = withConsumer(`
import type { Operations } from "./app.gen.js";

export const listPages: Operations["listPages"] = () => ({ claims: {}, entries: [], tags: [] });
export const withNote: Operations["listPages"] = () => ({ claims: {}, entries: [], tags: [], note: "n" });
`);
		expect(output, output).toBe("");
	});
});
