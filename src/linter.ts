import { defineLinter, type LinterDefinition } from "@typespec/compiler";
import { redosPronePatternRule } from "typespec-http-zod";
import { regexpRouterUnsupportedRule } from "./rules/regexp-router-unsupported.rule.js";

/**
 * **The advisory checks, opt-in, as TypeSpec expects them.**
 *
 * Enabled from a consumer's `tspconfig.yaml` with `linter: { extends: ["typespec-hono/recommended"] }`.
 *
 * **`redos-prone-pattern` is registered here as well as in `typespec-http-zod`.** A consumer of this
 * package lists only `typespec-hono`, and the library runs in-process, so it is never loaded as a
 * TypeSpec library and cannot be named in a ruleset - under pnpm it is not even resolvable from the
 * consumer's project. A rule's id is its registering library's name joined to the rule's, so here it
 * is `typespec-hono/redos-prone-pattern`, and one ruleset turns on everything that applies.
 */
/**
 * Typed explicitly through this package's own `@typespec/compiler` specifier, for the reason
 * `lib.ts` records: a side-by-side checkout resolves two copies of the compiler, and an INFERRED
 * declaration type then names the other package's copy by a `.pnpm` path (`TS2883`, "likely not
 * portable"). A published `.d.ts` naming such a path is broken for everyone who installed
 * differently.
 */
export const $linter: LinterDefinition = defineLinter({
	rules: [regexpRouterUnsupportedRule, redosPronePatternRule],
	ruleSets: {
		recommended: {
			enable: {
				[`typespec-hono/${regexpRouterUnsupportedRule.name}`]: true,
				[`typespec-hono/${redosPronePatternRule.name}`]: true,
			},
		},
	},
});
