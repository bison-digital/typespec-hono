import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **The handler boundary is where the generated types stop describing a payload and start obliging
 * the application**, and nothing in this package asked whether that obligation can be met.
 *
 * `typespec-http-zod@0.16.0` put an index signature on an open model's emitted type. The library's
 * own suite covers the contract types it writes; this one covers the signature a handler is written
 * against, which is derived separately - `Awaitable<Result<z.infer<typeof xSchema>>>` - and was not
 * fixed by fixing the library. See `open.tsp`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "open", { outName: "openmodel" });
}, 300_000);

/**
 * `tsc` over the generated directory plus one hand-written consumer file, then take the file away.
 *
 * Written at run time rather than committed, because a checked-in file importing `.out/` would make
 * `pnpm typecheck` depend on a build step and fail on a fresh clone.
 */
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

describe("a handler can return what the application already holds", () => {
	/**
	 * **No spread at any level, and a consumer's own types are interfaces.** A `type` alias gains an
	 * implicit index signature and pass whatever the emitter did (microsoft/TypeScript#15300), so an
	 * interface is the case that actually fails - and it is what most codebases have. A spread is the
	 * documented workaround, and needing one at 26 levels of nesting is what made this a defect.
	 */
	it("accepts a plain nested interface as a response body", () => {
		const output = withConsumer(`
import type { Operations } from "./app.gen.js";

interface DomainChild {
	id: string;
}

interface DomainParent {
	code: string;
	child: DomainChild;
}

const parent: DomainParent = { code: "c", child: { id: "i" } };

export const nested: Operations["nested"] = () => parent;
`);
		expect(output, output).toBe("");
	});

	/**
	 * The other direction, and it must NOT be narrowed. A handler RECEIVES whatever the validator let
	 * through, and a loose model really does pass unknown keys along, so the input type saying so is
	 * the honest description of the value in hand.
	 */
	it("still tells a handler that an open input may carry unknown keys", () => {
		const output = withConsumer(`
import type { Operations } from "./app.gen.js";

export const both: Operations["both"] = (_ctx, input) => {
	const extra: unknown = input.body["anything-at-all"];
	return { code: input.body.code, child: input.body.child, seen: extra };
};
`);
		expect(output, output).toBe("");
	});
});
