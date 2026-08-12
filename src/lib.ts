import {
	type CallableMessage,
	createTypeSpecLibrary,
	type DiagnosticReport,
	type JSONSchemaType,
	paramMessage,
	type Program,
	type TypeSpecLibrary,
} from "@typespec/compiler";
import { EmitterOptionsSchema as httpZodOptions, type EmitterOptions as HttpZodOptions } from "typespec-http-zod";

/**
 * The library definition, kept in its own module so `tsp-index.ts` and the emitter can both reach it
 * without importing each other.
 */

/**
 * Everything `typespec-http-zod` accepts, plus what a Hono server needs on top.
 *
 * ⚠️ **DERIVED, never restated, and the distinction is load-bearing.** This emitter runs the whole of
 * `typespec-http-zod` and adds one file; every option that package accepts has to reach it. Written
 * as a second literal list, an option added there would be rejected here as unknown — or worse,
 * accepted and silently dropped, which produces output that is wrong in a way no test of either
 * package would see. `test/options.test.ts` asserts the forwarding as a CLASS.
 *
 * There is currently nothing to add: `runtime-module` belongs to the library, because the library is
 * what emits the annotated response arms that need it. This type exists as the seam rather than
 * because it carries anything today — the moment a Hono-only option appears it goes here, and the
 * derivation keeps the rest honest.
 */
export type EmitterOptions = HttpZodOptions;

/**
 * ⚠️ **A spread of the published schema, so a new key arrives for free.**
 *
 * `properties` is spread rather than re-listed for the same reason the type is aliased rather than
 * re-declared. If this ever needs a Hono-only key, it is added to a spread of `httpZodOptions.properties`
 * — never by copying the list.
 */
const EmitterOptionsSchema: JSONSchemaType<EmitterOptions> = {
	...httpZodOptions,
	properties: { ...httpZodOptions.properties },
};

/**
 * What this emitter refuses that the library does not.
 *
 * The library refuses what no OpenAPI document can state. Everything here is narrower: what no *Hono
 * router* can mount. Two different questions, and keeping them in separate libraries is what stops a
 * consumer who wants validators without a server inheriting a refusal about routing.
 */
const diagnostics = {
	/**
	 * A path template this emitter will not translate into a route.
	 *
	 * ⚠️ **Refused rather than approximated, because the failure mode is a route that WORKS and is
	 * wrong.** Hono reads `:name` up to the next `/`, so an RFC 6570 modifier survives into the
	 * parameter name — `{id*}` becomes `:id*`, where `*` is Hono's own wildcard. That mounts a route
	 * which matches, answers, and binds the wrong thing, which is strictly worse than one that 404s.
	 *
	 * ⚠️ **The refusal lands HERE and not in the library, which is the whole point of the split.** The
	 * validators for such an operation are correct and are still emitted: what a request body must
	 * look like does not depend on whether some particular router can express the path. Only the
	 * server is impossible.
	 *
	 * Plain names are translated, including the hyphens and dots that `\w` used to drop on the floor —
	 * a parameter carrying a hyphen was left alone entirely, so `@path("thing-id")` produced the
	 * literal route `/things/{thing-id}`: mounted, counted by every arm that counted routes, and
	 * reachable by nobody.
	 */
	"unsupported-path-template": {
		severity: "error",
		messages: {
			default: paramMessage`'${"template"}' is not a path template this emitter can mount: the parameter '${"name"}' is not a plain name. Hono reads a parameter up to the next '/', so an RFC 6570 operator or modifier would become part of the name — or, for '*', a wildcard — and the route would match the wrong requests rather than fail. Name the parameter with letters, digits, '_', '-', '.' or '~'.`,
		},
	},
} as const;

/**
 * ⚠️ **Spelled out rather than inferred, and every type in it imported through THIS package's own
 * specifier.** Both this package and `typespec-http-zod` declare `@typespec/compiler` as a peer, so a
 * side-by-side checkout resolves two physically distinct copies of the identical version — measured,
 * two `.pnpm` paths differing only in which repository they sit under. TypeScript then had a choice
 * of which copy to name in the emitted declarations and chose the other package's, producing five
 * `TS2883`s whose message is exactly the problem: *"this is likely not portable"*.
 *
 * A published `.d.ts` naming a `node_modules/.pnpm/...` path is broken for everyone who installed
 * differently. Naming these through the direct import pins them to the specifier a consumer resolves,
 * whatever their tree looks like.
 *
 * ⚠️ **A consumer never hits this**, because a peer dependency is installed once and both packages
 * share it. That is precisely why it is worth guarding against here rather than trusting: the failure
 * exists only in the arrangement that BUILDS the package, and would ship silently.
 */
type Diagnostics = {
	"unsupported-path-template": { readonly default: CallableMessage<["template", "name"]> };
};

/**
 * ⚠️ **Annotated rather than inferred, and the reason is a packaging fact rather than a style
 * preference.** This package and `typespec-http-zod` each resolve their own `@typespec/compiler` —
 * that is what a peer dependency does, and a consumer installing both gets one copy while a
 * side-by-side checkout gets two. Inferring the type here makes the emitted `.d.ts` name a compiler
 * through a path that exists only in the tree it was built in: `TS2883`, five of them, and the
 * message says it outright — *"this is likely not portable"*.
 *
 * A published declaration file that names a `node_modules/.pnpm/...` path is broken for everyone who
 * installed differently. Naming the type explicitly is what makes the declaration stand on its own,
 * and this is exactly the class of defect a package built inside one workspace never has to face.
 */
export const $lib: TypeSpecLibrary<Diagnostics, EmitterOptions> = createTypeSpecLibrary({
	name: "typespec-hono",
	diagnostics,
	emitter: { options: EmitterOptionsSchema },
});

export const reportDiagnostic: <C extends keyof Diagnostics, M extends keyof Diagnostics[C]>(
	program: Program,
	diagnostic: DiagnosticReport<Diagnostics, C, M>,
) => void = $lib.reportDiagnostic;
export { EmitterOptionsSchema };
