import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A handler supplies what the server accepts: the schema's INPUT, not its output.** See
 * `defaults.tsp`.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let compiled: CompiledFixture;

beforeAll(async () => {
	compiled = await compileFixture(here, "defaults", { outName: "defaults" });
}, 300_000);

function typecheck(source: string): string {
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

describe("a defaulted response property", () => {
	it("may be left out by a handler, and a contract value may be returned as it is", () => {
		const output = typecheck(`
import type { Operations } from "./app.gen.js";
import type { WireOutputs } from "./contracts.barrel.js";

export const omits: Operations["readRow"] = (_ctx, input) => ({ status: 200, body: { id: input.id } });

declare const fromBackend: WireOutputs["readRow"];
export const forwards: Operations["readRow"] = () => ({ status: 200, body: fromBackend });
`);
		expect(output).toBe("");
	});

	it("is served with the default the schema fills", async () => {
		const { registerRoutes } = (await import(join(compiled.outDir, "app.gen.ts"))) as {
			registerRoutes: (app: Hono, handlersFor: unknown, deps: unknown) => Hono;
		};
		const app = new Hono();
		registerRoutes(
			app,
			() => ({
				readRow: (_c: unknown, input: { id: string }) => ({ status: 200, body: { id: input.id } }),
			}),
			{
				authorize: () => async (_c: unknown, next: () => Promise<void>) => {
					await next();
				},
				context: () => ({}),
				noContext: () => new Response(null, { status: 401 }),
				notAcceptable: () => new Response(null, { status: 406 }),
				invalid: () => undefined,
			},
		);
		const response = await app.request("/rows/r1");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ id: "r1", count: 0 });
	});
});
