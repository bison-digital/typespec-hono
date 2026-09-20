import {
	type CallableMessage,
	createRule,
	type LinterRuleDefinition,
	paramMessage,
} from "@typespec/compiler";
import { getAllHttpServices } from "@typespec/http";
import { routeTemplateOf } from "typespec-http-zod";
import { regExpRouterRefusal, routerTableFor } from "../app.js";
import { resolveBasePath } from "../base-path.js";

/**
 * **A route set Hono's `RegExpRouter` refuses to compile.**
 *
 * **A linter rule, because TypeSpec's own definition puts it there.** A diagnostic says the program
 * is not valid for this library; a linter says it "could be correct, but there might be room for
 * improvements", and has to be enabled explicitly. Here the spec is valid, the document is correct,
 * the emitted server is correct, and the default router serves it perfectly - `SmartRouter` tries
 * `RegExpRouter` and falls back to `TrieRouter` for exactly this case. What can go wrong is a router
 * choice the application makes, which this package cannot see.
 *
 * **Why that matters, measured.** Raised as an automatic warning it failed the build of a consumer
 * that sets `warn-as-error: true` and constructs `new Hono()` - the default router, which holds its
 * route set - over a problem that consumer does not have.
 *
 * **Why it is worth enabling.** `RegExpRouter` throws `UnsupportedPathError` for a static segment
 * beside a path parameter at the same position - `/users/me` next to `/users/{id}`, the commonest
 * shape in REST - inside `registerRoutes`, at module scope, so a Worker constructed with one never
 * starts. The documentation once recommended it. Measured: one added route took a live worker from
 * serving to connection-refused, from a compile that reported success.
 *
 * **Hono's real router is asked, not a reimplementation of its rule**, which is undocumented and
 * version-specific, and the route set asked about is built by {@link routerTableFor} from the same
 * pieces the render uses. The corpus oracle mounts every generated server under a bare
 * `RegExpRouter` and fails if this rule's verdict disagrees in either direction.
 *
 * **Reported against the service**, because which routes `RegExpRouter` refuses is a property of the
 * route SET: no single operation is the one at fault.
 */
export const regexpRouterUnsupportedRule: LinterRuleDefinition<
	"regexp-router-unsupported",
	{ readonly default: CallableMessage<["path", "reason"]> }
> = createRule({
	name: "regexp-router-unsupported",
	severity: "warning",
	description: "Flag a route set Hono's RegExpRouter cannot compile.",
	messages: {
		default: paramMessage`This service mounts '${"path"}', which Hono's 'RegExpRouter' cannot compile: ${"reason"}. A bare 'RegExpRouter' throws inside 'registerRoutes' at module scope, so the Worker would not start at all. Use 'new Hono()' for the default 'SmartRouter', or 'new Hono({ router: new PatternRouter() })'. Both mount this route set. The default is the one to reach for first: it settles on 'TrieRouter', which measures the same as 'RegExpRouter' in steady state, while 'PatternRouter' costs about five times more.`,
	},
	create(context) {
		return {
			root: (program) => {
				// Its diagnostics are the emitter's to report, once, during emission.
				const [services] = getAllHttpServices(program);
				for (const service of services) {
					const routes = service.operations.map((operation) => ({
						verb: operation.verb.toUpperCase(),
						pathSegments: routeTemplateOf(
							operation.uriTemplate,
							operation.parameters.parameters
								.filter((parameter) => parameter.type === "path")
								.map((parameter) => ({
									name: parameter.name,
									optional: parameter.param.optional,
									reserved: parameter.type === "path" && parameter.allowReserved,
								})),
						).segments,
					}));
					const refusal = regExpRouterRefusal(
						routerTableFor(routes, resolveBasePath(program, service.namespace).basePaths),
					);
					if (refusal !== undefined) {
						context.reportDiagnostic({ format: refusal, target: service.namespace });
					}
				}
			},
		};
	},
});
