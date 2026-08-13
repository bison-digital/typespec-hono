import { emitFile, resolvePath, type EmitContext, type Type } from "@typespec/compiler";
import type { EmittedService } from "typespec-http-zod";
import type { HttpOperation } from "@typespec/http";
import { emitHttpZod } from "typespec-http-zod";
import { renderApp } from "./app.js";
import { resolveBasePath } from "./base-path.js";
import { securityFor } from "./security.js";
import { reportDiagnostic } from "./lib.js";

/**
 * This emitter's entry point — **the whole of `typespec-http-zod`, plus one file**.
 *
 * ⚠️ **A consumer lists ONE emitter, and this is why.** The validators and the server share a naming
 * contract: `app.gen.ts` imports `readWidgetPath` and `readWidgetResponses` from `schemas.gen.js` by
 * name. Two separate TypeSpec emitters would each get their own `$onEmit` and their own registry, and
 * would have to arrive at identical identifiers by coincidence. Running the library here means it
 * mints the names, writes them, and hands them back — so agreement is structural rather than hoped
 * for.
 *
 * ⚠️ **It uses nothing `typespec-http-zod` does not export.** The package's `exports` map makes a deep
 * import impossible, so this file is the proof that the published API is sufficient to build a server
 * generator on. Anything it cannot do from here is a gap in that API, to be fixed there.
 */
/**
 * The HTTP operation an emitted route came from, keyed on verb and path.
 *
 * ⚠️ **Keyed on the ROUTE, not on the name, and the name was wrong for every interface.**
 * `EmittedRoute.operationId` is the id the document publishes — `Accounts_list`, with the interface
 * prefix `resolveOperationId` inserts — while `operation.operation.name` is the bare `list`. Matching
 * them never succeeded for an operation declared inside an `interface`, which is most of them.
 *
 * Two things rested on that lookup and both were silently wrong: every diagnostic pointed at the
 * service namespace instead of the operation that caused it, and the security requirements resolved
 * to none, so a scheme-gated route emitted no gate. Verb and path identify a route exactly, and are
 * what both sides already agree on.
 */
function operationFor(
	emitted: EmittedService,
	verb: string,
	path: string,
): HttpOperation | undefined {
	return emitted.service.operations.find(
		(candidate) => candidate.verb.toUpperCase() === verb.toUpperCase() && candidate.path === path,
	);
}

/** The declaration a diagnostic should point at, falling back to the service when it cannot be found. */
function targetFor(emitted: EmittedService, verb: string, path: string): Type {
	return operationFor(emitted, verb, path)?.operation ?? emitted.service.namespace;
}

/**
 * What the generated files import their runtime contract from when the consumer sets nothing.
 *
 * ⚠️ **THIS package's runtime, not the library's, and the distinction is the whole of a defect that
 * shipped.** `app.gen.ts` names `AppEnv`, `Awaitable`, `Ctx`, `Result`, `RouteDeps` and
 * `selectContentType`; every one of them is declared in `src/runtime.ts` here. The library's runtime
 * exports `ResponseArm` and `armFor` and nothing else — and it is a TRANSITIVE dependency of a
 * consumer of this package, so under a strict `node_modules` its specifier does not resolve from
 * consumer code at all.
 *
 * Pointing at `typespec-hono/runtime` fixes both halves at once, because this module RE-EXPORTS
 * `ResponseArm` and `armFor` (see `runtime.ts`) — which is what `schemas.gen.ts` imports. One
 * specifier, present in the consumer's own dependency, carrying every name both generated files
 * reference.
 *
 * ⚠️ **Measured in a fresh project installed from `pnpm pack` tarballs, because no test could see it:**
 * every compile in both harnesses sets `runtime-module` explicitly, so the default branch was ungraded
 * across 240 tests. `tsp compile` succeeded with zero diagnostics and `tsc` then reported two
 * `TS2307`s — `Cannot find module 'typespec-http-zod/runtime'` — one in each generated file.
 * `test/adopter.test.ts` is the arm that now opens that branch.
 */
export const DEFAULT_RUNTIME_MODULE = "typespec-hono/runtime";

export async function $onEmit(context: EmitContext): Promise<void> {
	for (const emitted of await emitHttpZod(context, {
		defaultRuntimeModule: DEFAULT_RUNTIME_MODULE,
	})) {
		/**
		 * ⚠️ **The path the DOCUMENT says this service is served under.** An OpenAPI path is relative to
		 * its server, so `@server("/api/v1")` plus `/accounts` publishes `/api/v1/accounts`. Mounting at
		 * the root made every client generated from the document 404.
		 */
		const base = resolveBasePath(context.program, emitted.service.namespace);
		if (base.ambiguous.length > 0) {
			reportDiagnostic(context.program, {
				code: "ambiguous-server-path",
				format: { paths: base.ambiguous.join(", ") },
				target: emitted.service.namespace,
			});
		}
		await emitFile(context.program, {
			path: resolvePath(emitted.outputDir, "app.gen.ts"),
			content: renderApp(
				emitted,
				{
					/**
					 * Reported rather than thrown, so a spec with one unmountable path still names every
					 * other problem in the same compile — and so the validators for the rest of the service
					 * are still written. A path this router cannot express is not a reason to emit nothing.
					 */
					unsupportedPathTemplate: (route, template, name) => {
						reportDiagnostic(context.program, {
							code: "unsupported-path-template",
							format: { template, name },
							target: targetFor(emitted, route.verb, route.path),
						});
					},
					unroutableVerb: (route) => {
						reportDiagnostic(context.program, {
							code: "unroutable-verb",
							format: { operationId: route.operationId, verb: route.verb },
							target: targetFor(emitted, route.verb, route.path),
						});
					},
				},
				base.basePath,
				(verb, path) => {
					const operation = operationFor(emitted, verb, path);
					return operation === undefined ? [] : securityFor(context.program, operation);
				},
			),
		});
	}
}
