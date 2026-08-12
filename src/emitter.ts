import { emitFile, resolvePath, type EmitContext, type Type } from "@typespec/compiler";
import type { EmittedService } from "typespec-http-zod";
import { emitHttpZod } from "typespec-http-zod";
import { renderApp } from "./app.js";
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
/** The declaration a diagnostic should point at, falling back to the service when it cannot be found. */
function targetFor(emitted: EmittedService, operationId: string): Type {
	return (
		emitted.service.operations.find((operation) => operation.operation.name === operationId)
			?.operation ?? emitted.service.namespace
	);
}

export async function $onEmit(context: EmitContext): Promise<void> {
	for (const emitted of await emitHttpZod(context)) {
		await emitFile(context.program, {
			path: resolvePath(emitted.outputDir, "app.gen.ts"),
			content: renderApp(emitted, {
				/**
				 * Reported rather than thrown, so a spec with one unmountable path still names every
				 * other problem in the same compile — and so the validators for the rest of the service
				 * are still written. A path this router cannot express is not a reason to emit nothing.
				 */
				unsupportedPathTemplate: (route, template, name) => {
					reportDiagnostic(context.program, {
						code: "unsupported-path-template",
						format: { template, name },
						target: targetFor(emitted, route.operationId),
					});
				},
				unroutableVerb: (route) => {
					reportDiagnostic(context.program, {
						code: "unroutable-verb",
						format: { operationId: route.operationId, verb: route.verb },
						target: targetFor(emitted, route.operationId),
					});
				},
			}),
		});
	}
}
