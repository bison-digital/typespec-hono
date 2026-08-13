import { getAuthenticationForOperation, type HttpOperation } from "@typespec/http";
import type { Program } from "@typespec/compiler";
import type { SecurityRequirement } from "./runtime.js";

/**
 * What the DOCUMENT says a caller must satisfy, in the shape the document says it.
 *
 * ⚠️ **The scheme was being thrown away, and only "is a caller needed" survived.** `@useAuth(BearerAuth)`
 * reaches OpenAPI as `security: [{ "BearerAuth": [] }]`, and this emitter reduced that to
 * `deps.context(c, "required")`. A gate was emitted ONLY when the scheme carried scopes — so for
 * bearer, api-key and basic, which is the common case, nothing carried which scheme at all. An
 * application whose `context` read a cookie would happily serve a route the document says needs a
 * bearer token, and nothing anywhere would notice.
 *
 * ⚠️ **Passed through, never enforced here.** Which credentials satisfy a scheme is the application's
 * business and could not be anything else; which schemes an operation ACCEPTS is a contract fact and
 * is now generated. That is the same split as `context` and `respond`, applied to the half that was
 * missing.
 */

// Declared in `runtime.ts`, which an application imports and which must stay compiler-free.
export type { SecurityRequirement } from "./runtime.js";

/**
 * The requirements an operation declares. Satisfying **any one** of them authorises the caller —
 * which is what an array of `security` objects means in OpenAPI, and why this is a list of lists
 * rather than a flat set of scopes.
 *
 * Empty when the operation declares `@useAuth(NoAuth)` or no authentication at all.
 */
export function securityFor(program: Program, operation: HttpOperation): SecurityRequirement[] {
	const authentication = getAuthenticationForOperation(program, operation.operation);
	const requirements: SecurityRequirement[] = [];
	for (const option of authentication?.options ?? []) {
		const requirement: Record<string, readonly string[]> = {};
		let anonymous = false;
		for (const scheme of option.schemes) {
			/**
			 * ⚠️ **`NoAuth` inside an option means that option needs nothing**, which is how a spec says
			 * "authentication is optional here". It is not a scheme to demand, and emitting it as one
			 * would refuse every anonymous caller the document permits.
			 */
			if (scheme.type === "noAuth") {
				anonymous = true;
				continue;
			}
			/**
			 * Scopes belong to the flows of an OAuth2 scheme; every other kind has none. Read from the
			 * scheme rather than assumed, and de-duplicated because two flows may name the same scope.
			 */
			const scopes =
				scheme.type === "oauth2"
					? [...new Set(scheme.flows.flatMap((flow) => flow.scopes.map((scope) => scope.value)))]
					: [];
			requirement[scheme.id] = scopes;
		}
		if (anonymous && Object.keys(requirement).length === 0) continue;
		if (Object.keys(requirement).length > 0) requirements.push(requirement);
	}
	return requirements;
}

/** The requirements as a TypeScript literal, for the generated call site. */
export function renderSecurity(requirements: readonly SecurityRequirement[]): string {
	return `[${requirements
		.map(
			(requirement) =>
				`{ ${Object.entries(requirement)
					.map(
						([scheme, scopes]) =>
							`${JSON.stringify(scheme)}: [${scopes.map((s) => JSON.stringify(s)).join(", ")}]`,
					)
					.join(", ")} }`,
		)
		.join(", ")}]`;
}
