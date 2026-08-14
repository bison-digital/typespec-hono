import { rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";

/**
 * Compile one `.tsp` fixture with this emitter, and hand back where it landed.
 *
 * **One emitter, five files.** This package runs the whole of `typespec-http-zod` and adds
 * `app.gen.ts`, so a fixture lists `typespec-hono` alone and gets the validators too. That is the
 * arrangement a consumer has, and compiling it any other way would test something nobody ships.
 */
export interface CompiledFixture {
	readonly outDir: string;
	/** Where `@typespec/openapi3` wrote, when `withDocument` was set. */
	readonly documentDir: string;
	readonly diagnostics: readonly { readonly code: string; readonly severity: string }[];
}

const CONTRACTS_BARREL = "contracts.barrel";

/**
 * The runtime contract, as a specifier the emitted files can resolve.
 *
 * **Relative, and spelled `.js`.** An absolute path bakes one machine's checkout into generated
 * output; a `.ts` extension is rejected under `nodenext`. Pointed at THIS package's runtime, which
 * re-exports the library's two names, so a generated `schemas.gen.ts` and a generated `app.gen.ts`
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
	 * **Two suites compiling one fixture to one directory with DIFFERENT options overwrite each
	 * other, and vitest runs test files in parallel.** Measured: the same `HEAD` request answered 400,
	 * 200 and 204 across three runs of an unchanged emitter, because whichever suite compiled last
	 * decided what the other was asserting against. A suite that races itself is not evidence, and the
	 * failure looks exactly like a flaky emitter.
	 */
	readonly outName?: string;
	/** The full output directory, when a suite owns one of its own rather than sharing `dir/.out/`. */
	readonly outDir?: string;
	/**
	 * Compile with NOTHING set but the output directory. The configuration the README's own example
	 * produces.
	 *
	 * **This exists because every other compile in this suite configures the default away, and a
	 * defect lived in the gap for the whole life of the package.** `runtime-module` was set by this
	 * helper on line 64 and by the corpus harness, so across 83 tests here and 157 in the library
	 * nothing ever compiled with the emitter's own default, which pointed at a module that exports
	 * none of the six names `app.gen.ts` imports and does not resolve from consumer code at all.
	 *
	 * Note what {@link runtimeFixtureModule} says about itself: it points at THIS package's runtime
	 * "exactly as a consumer's would". The harness had the right answer written down as a workaround
	 * while the shipped default did something else. A fixture that compensates for a defect is a
	 * fixture that hides it.
	 */
	readonly bare?: boolean;
	/**
	 * Also run `@typespec/openapi3`, so a test can compare the two artefacts a consumer receives.
	 *
	 * Off by default because it roughly doubles a fixture compile, and most arms grade the server
	 * alone. On where the claim is that the server agrees with the DOCUMENT, which several docblocks
	 * asserted while reading only the server.
	 */
	readonly withDocument?: boolean;
	/** Anything else the emitter accepts, for an option a single suite exercises. */
	readonly extraOptions?: Readonly<Record<string, unknown>>;
}

export async function compileFixture(
	dir: string,
	name: string,
	options: FixtureOptions = {},
): Promise<CompiledFixture> {
	/**
	 * `outDir` lets a sweep own a directory no other suite writes. See `emitted-set.ts` for the
	 * defect that made it necessary: three oracles graded whatever the previous run had left behind.
	 */
	const outDir = options.outDir ?? join(dir, ".out", options.outName ?? name);
	/**
	 * **Emptied first, so an assertion cannot be answered by the previous run.**
	 *
	 * An emitter that stops writing a file leaves the last one on disk, and every oracle reading that
	 * directory keeps passing. Measured in the sibling library: a control that deleted a fix from
	 * `src/` passed green, because the assertions found yesterday's output. Nothing about that looks
	 * wrong from the outside, which is what makes it worth deleting the directory rather than trusting
	 * that each compile overwrites what the last one wrote.
	 *
	 * Deleting rather than overwriting is also the only way an arm can assert a file is ABSENT, which
	 * a refusal has to be able to prove.
	 */
	rmSync(outDir, { recursive: true, force: true });
	const program = await compile(NodeHost, join(dir, `${name}.tsp`), {
		outputDir: outDir,
		emit:
			options.withDocument === true ? ["typespec-hono", "@typespec/openapi3"] : ["typespec-hono"],
		options: {
			"@typespec/openapi3": { "emitter-output-dir": join(outDir, "openapi"), "file-type": "json" },
			"typespec-hono":
				options.bare === true
					? { "emitter-output-dir": outDir, ...(options.extraOptions ?? {}) }
					: {
							"emitter-output-dir": outDir,
							"contracts-output-dir": outDir,
							"contracts-package": `./${CONTRACTS_BARREL}.js`,
							"seal-object-schemas": true,
							"runtime-module": options.runtimeModule ?? runtimeFixtureModule(outDir),
							...(options.extraOptions ?? {}),
						},
		},
	});
	if (options.bare !== true) {
		writeFileSync(
			join(outDir, `${CONTRACTS_BARREL}.ts`),
			[
				"// The contracts package, as a consumer's would be: one specifier over both artefacts.",
				'export * from "./requests.gen.js";',
				'export * from "./vocabularies.gen.js";',
				"",
			].join("\n"),
		);
	}
	return {
		outDir,
		documentDir: join(outDir, "openapi"),
		diagnostics: program.diagnostics.map((d) => ({ code: d.code, severity: d.severity })),
	};
}
