import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";

/**
 * Compile one `.tsp` fixture with this emitter, and hand back where it landed.
 *
 * ⚠️ **One emitter, five files.** This package runs the whole of `typespec-http-zod` and adds
 * `app.gen.ts`, so a fixture lists `typespec-hono` alone and gets the validators too. That is the
 * arrangement a consumer has, and compiling it any other way would test something nobody ships.
 */
export interface CompiledFixture {
	readonly outDir: string;
	readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
}

const CONTRACTS_BARREL = "contracts.barrel";

/**
 * The runtime contract, as a specifier the emitted files can resolve.
 *
 * ⚠️ **Relative, and spelled `.js`.** An absolute path bakes one machine's checkout into generated
 * output; a `.ts` extension is rejected under `nodenext`. Pointed at THIS package's runtime, which
 * re-exports the library's two names — so a generated `schemas.gen.ts` and a generated `app.gen.ts`
 * import their contract from the same module, exactly as a consumer's would.
 */
function runtimeFixtureModule(outDir: string): string {
	const runtime = fileURLToPath(new URL("../../src/runtime.ts", import.meta.url));
	const specifier = relative(outDir, runtime).replaceAll("\\", "/").replace(/\.ts$/, ".js");
	return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

export interface FixtureOptions {
	/** Where the emitted files import their runtime contract from. See {@link runtimeFixtureModule}. */
	readonly runtimeModule?: string;
	/**
	 * The output directory's name, when it must differ from the spec's.
	 *
	 * ⚠️ **Two suites compiling one fixture to one directory with DIFFERENT options overwrite each
	 * other, and vitest runs test files in parallel.** Measured: the same `HEAD` request answered 400,
	 * 200 and 204 across three runs of an unchanged emitter, because whichever suite compiled last
	 * decided what the other was asserting against. A suite that races itself is not evidence, and the
	 * failure looks exactly like a flaky emitter.
	 */
	readonly outName?: string;
}

export async function compileFixture(
	dir: string,
	name: string,
	options: FixtureOptions = {},
): Promise<CompiledFixture> {
	const outDir = join(dir, ".out", options.outName ?? name);
	const program = await compile(NodeHost, join(dir, `${name}.tsp`), {
		outputDir: outDir,
		emit: ["typespec-hono"],
		options: {
			"typespec-hono": {
				"emitter-output-dir": outDir,
				"contracts-output-dir": outDir,
				"contracts-package": `./${CONTRACTS_BARREL}.js`,
				"seal-object-schemas": true,
				"runtime-module": options.runtimeModule ?? runtimeFixtureModule(outDir),
			},
		},
	});
	writeFileSync(
		join(outDir, `${CONTRACTS_BARREL}.ts`),
		[
			"// The contracts package, as a consumer's would be: one specifier over both artefacts.",
			'export * from "./requests.gen.js";',
			'export * from "./vocabularies.gen.js";',
			"",
		].join("\n"),
	);
	return {
		outDir,
		diagnostics: program.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
	};
}
