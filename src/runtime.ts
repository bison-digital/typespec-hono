import type { Context, Env, Input, MiddlewareHandler } from "hono";
import type { ResponseArm } from "typespec-http-zod/runtime";

/**
 * **`ResponseArm` and `armFor` live in `typespec-http-zod` and are re-exported here.**
 *
 * The library is what emits the response arms, `schemas.gen.ts` declares them and annotates them
 * with `satisfies readonly ResponseArm[]`, so the type belongs to the package that produces it, and
 * the rule for reading an array containing `4XX` and `default` belongs beside it. A consumer serving
 * those validators from Express needs both and should not depend on a Hono emitter to get them.
 *
 * Re-exported rather than merely available, so an application still has ONE runtime import and the
 * `runtime-module` substitution keeps working unchanged: a module an app points that option at has to
 * supply every name the generated files reference, and they reference these.
 */
export { armFor, type ResponseArm } from "typespec-http-zod/runtime";

/**
 * One acceptable combination of credentials, exactly as OpenAPI's `security` states it: scheme id to
 * the scopes that scheme requires. Every entry in one requirement must be satisfied TOGETHER, and
 * satisfying ANY ONE requirement authorises the caller.
 *
 * **Declared here rather than beside the code that derives it**, because `./runtime` is what a
 * running server imports and must stay free of every build-time dependency, a packaging arm asserts
 * it names no `@typespec/*` package at all. An application should not drag a compiler into its
 * Worker to read one type.
 */
export type SecurityRequirement = Readonly<Record<string, readonly string[]>>;

/**
 * The contract between the GENERATED server and the app that mounts it.
 *
 * **This exists because "here is a data table, write your own router" is not a deliverable.**
 * The emitter used to produce `GENERATED_ROUTES` (one array of plain objects) and every consumer
 * had to hand-write a loop that interpreted it at run time. In this repository that loop is 220
 * lines, it sits outside every oracle the emitter is judged by, and it carries a cast that exists
 * *only* because iterating a homogeneous array throws away the per-operation types the emitter knew:
 * `backend[operationId]` is a union of 104 differently-typed methods, so nothing about the call can
 * be checked. Generating the server removes the loop, the cast, and the compensating type-level
 * assertion invented to put the guarantee back.
 *
 * What is left for the app to supply is genuinely app-specific: how a request becomes a caller's
 * context, and how a result becomes a response. Everything else, routing, validation, which
 * validator applies to which target, what status each arm answers, is generated.
 */

/**
 * How an operation's return value is wrapped.
 *
 * Identity by default, so an operation may simply return its value. An app with a result envelope
 * points `runtime-module` at its own module and re-declares this as, say, `ServiceResult<T>`, which
 * is what keeps the generated `Operations` interface concretely typed end to end instead of falling
 * back to `unknown` and reintroducing the cast this whole change exists to delete.
 */
export type Result<T> = T;

/**
 * The Hono environment the generated server mounts on, and the caller context its operations take.
 *
 * **Concrete on purpose.** Making `registerRoutes` generic over the environment does not work:
 * Hono narrows `Context` per route and its conditional types cannot reduce
 * `IfAnyThenEmptyObject<E extends Env ? ...>` while `E` is an unbound parameter, so nothing the app
 * supplies is ever assignable and every call site needs a cast. Naming the types here instead, an
 * app points `runtime-module` at its own module and re-declares them, keeps every generated call
 * site concrete and cast-free. Identity defaults, so an app with neither can ignore both.
 */
export type AppEnv = Env;
export type Ctx = unknown;

/** Anything an operation may hand back: the value, or a promise of it. */
export type Awaitable<T> = T | Promise<T>;

/**
 * Pick the media type to serve, per RFC 9110 section 12.5.1.
 *
 * **In the runtime rather than in {@link RouteDeps}, deliberately.** The test for admitting
 * anything to `deps` is *the generated code cannot proceed without an answer*, and this is not that:
 * which media types an operation offers is a contract fact the emitter reads from the document, and
 * how `Accept` selects among them is specified by the RFC. Both sides are derivable, so an app that
 * had to supply this would be re-implementing the standard, and could get it wrong differently from
 * everybody else.
 *
 * The rules that matter, and that a naive `includes()` gets wrong:
 * - **absent or empty `Accept` means anything is acceptable**, serve the first offer;
 * - **`q=0` is a REFUSAL**, not a weak preference, so a range scoring zero can never be chosen;
 * - **specificity breaks ties before quality does**: `text/plain` beats `text/*` beats `*​/*` at
 *   equal `q`, which is why the score is a pair and not a number;
 * - parameters after the media range (`;charset=utf-8`) are not part of the match.
 *
 * Returns `undefined` when nothing offered is acceptable. The caller answers 406, and the
 * difference between "no preference" and "no acceptable option" is exactly what that turns on.
 */
export function selectContentType(
	accept: string | undefined,
	offered: readonly string[],
): string | undefined {
	if (offered.length === 0) return undefined;
	const header = accept?.trim();
	if (header === undefined || header === "") return offered[0];

	const ranges = header.split(",").map((entry) => {
		const [range = "", ...parameters] = entry.split(";").map((part) => part.trim());
		const quality = parameters
			.map((parameter) => /^q=(?<value>[\d.]+)$/i.exec(parameter)?.groups?.value)
			.find((value) => value !== undefined);
		return { range: range.toLowerCase(), q: quality === undefined ? 1 : Number(quality) };
	});

	let best: { type: string; q: number; specificity: number } | undefined;
	for (const type of offered) {
		const [group] = type.toLowerCase().split("/");
		for (const { range, q } of ranges) {
			// `q=0` is "I will not accept this", so it never becomes a candidate.
			if (!Number.isFinite(q) || q <= 0) continue;
			const specificity =
				range === type.toLowerCase() ? 2 : range === `${group}/*` ? 1 : range === "*/*" ? 0 : -1;
			if (specificity < 0) continue;
			if (best === undefined || q > best.q || (q === best.q && specificity > best.specificity)) {
				best = { type, q, specificity };
			}
		}
	}
	return best?.type;
}

/**
 * Let only a real HEAD request through.
 *
 * Hono rewrites HEAD to GET before matching, so a `@head` operation has to be registered under GET
 * to be reachable at all. Where the document declares no GET on that path, this keeps the
 * registration honest: a GET gets the 404 it would have got if the route had never been registered,
 * and only a HEAD reaches the validators and the handler. `c.req.method` still reads `HEAD` after the
 * rewrite, which is what makes the distinction possible.
 *
 * In the runtime rather than in {@link RouteDeps} on the usual test: the generated code can proceed
 * without asking the app anything. Which verbs the document declares is a contract fact, and the
 * answer for a verb it does not declare is the same 404 any unrouted request already gets, through
 * whatever `app.notFound()` the application has set.
 *
 * A plain middleware rather than `except()` from `hono/combine`, because `except` wraps the final
 * handler and erases its response type, and Hono's RPC client derives its whole surface from that
 * type. Measured: `hc<typeof app>` resolved a wrapped route's body to `unknown`.
 */
export const headOnly: MiddlewareHandler = async (c, next) =>
	c.req.method === "HEAD" ? next() : c.notFound();

/**
 * Apply the validator that parses the media type the request actually carries.
 *
 * A route may declare several request media types needing different parsers -- `addPet` in the
 * Swagger Petstore accepts JSON, XML and urlencoded on one path. `zValidator`'s target is fixed when
 * the server is generated; which parser applies is decided by the caller's `Content-Type` when the
 * request arrives. Those are different times, and only the second one has the answer.
 *
 * **Before this, one target was chosen for the whole route and everything else was rejected.** A
 * form-encoded body to a route declaring JSON first was handed to `c.req.json()` and answered 400,
 * with no diagnostic anywhere. The status looked like the caller's fault and was not.
 *
 * Parameters after the media type (`; charset=utf-8`, `; boundary=...`) are not part of the match,
 * which matters because a multipart request always carries a boundary.
 *
 * A `Content-Type` matching nothing declared falls through to the first validator, which reproduces
 * the previous behaviour exactly for that case: the body fails to parse and `deps.invalid` answers.
 * No status is invented here that the document does not describe.
 */
export function byContentType<E extends Env>(
	validators: readonly (readonly [
		mediaType: string,
		target: string,
		validator: MiddlewareHandler<E>,
	])[],
): MiddlewareHandler<E> {
	return async (c, next) => {
		const declared = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
		const matched = validators.find(([mediaType]) => mediaType.toLowerCase() === declared);
		const [, , validator] = matched ?? (validators[0] as (typeof validators)[number]);
		return validator(c, next);
	};
}

/**
 * What the app provides. One object, passed once, rather than a module the generated file imports by
 * path. A generated server that hard-codes `../../backend.js` is only usable by the project it was
 * generated in, and this one has to be usable by any.
 *
 * **The hooks are generic over Hono's path and input parameters, deliberately.** Hono narrows
 * `Context` per route, by the literal path, and by whatever the validators on that route produced,
 * so a hook typed against a single `Context<E>` is not assignable at any real call site. Making the
 * hooks generic lets the app write functions that ignore both, without a cast anywhere.
 *
 * **`E` and `C` are PARAMETERS, and they have to be.** The defaults keep the bare `RouteDeps` the
 * generated server writes working for an app that substitutes nothing. An app that substitutes
 * anything binds them once, `export type RouteDeps = BaseRouteDeps<AppEnv, Ctx>` in the module it
 * points `runtime-module` at, and every hook is then typed against its own environment and its own
 * caller context.
 *
 * Re-exporting this interface unparameterised instead does not work, and the reason is not obvious:
 * **Hono's `Context` is INVARIANT in its environment**, because `Context.set` takes `E` as an
 * argument. So `Context<AppEnv, ...>` is not assignable to `Context<Env, ...>` however plain the
 * substituted environment is, and every generated `deps.*` call site fails. Separately, `context`
 * would keep returning the identity `Ctx` (`unknown`) which the app's own handlers then reject.
 * Measured before this was parameterised: **19 errors on a four-operation service.**
 */
export interface RouteDeps<E extends Env = AppEnv, C = Ctx> {
	/**
	 * The gate the DOCUMENT publishes, as middleware.
	 *
	 * **Which scopes an operation demands is a contract fact; how a token is verified is not.**
	 * `@useAuth(OAuth2Auth<...>)` reaches OpenAPI as `security` per operation, so the requirement is
	 * generated and this implements the check. The same split as `context` and `respond`. Emitted
	 * only where the operation declares scopes, which is why an internal surface with none is
	 * unaffected.
	 *
	 * Its absence was a real defect for one commit: the generated server carried **zero** references
	 * to scopes while the document published eleven, so a surface mounted with its gate silently
	 * dropped.
	 *
	 * **It receives the document's REQUIREMENTS, not a flat list of scopes, and that is the second
	 * half of the same defect.** `@useAuth(BearerAuth)` publishes `security: [{ "BearerAuth": [] }]`
	 * with no scopes, so a scopes-only gate was emitted for OAuth2 and for nothing else. Bearer, api-key
	 * and basic, which is most services, carried no gate at all and rested entirely on `context`
	 * returning null. An app whose `context` read a cookie would serve a route the document says needs
	 * a bearer token.
	 *
	 * Satisfying ANY ONE requirement authorises the caller, and every scheme WITHIN a requirement must
	 * be satisfied together, which is exactly what an array of OpenAPI `security` objects means.
	 */
	readonly authorize: (requirements: readonly SecurityRequirement[]) => MiddlewareHandler<E>;
	/**
	 * The caller's context, or `null` when there is none to establish.
	 *
	 * `authentication` is what the DOCUMENT says, and only that: `"none"` where the operation
	 * declares `@useAuth(NoAuth)` (`security: []` in OpenAPI) and `"required"` otherwise. Deciding
	 * it at generation time is the point: the gate the document publishes is the gate that runs.
	 *
	 * **It used to be `"none" | "account" | "resource"`, and the last two were an invention.** They
	 * were chosen by whether the path had parameters, which no OpenAPI keyword expresses and which
	 * merely happened to fit the first consumer. A generated server enforcing a rule derived from
	 * nothing published is the defect class this emitter exists to remove, so it is gone. An app that
	 * needs the distinction can read the request, which is the one thing it definitely has.
	 */
	readonly context: <P extends string, I extends Input>(
		c: Context<E, P, I>,
		authentication: "none" | "required",
	) => C | null;
	/** The response when `context` returns `null`. */
	readonly noContext: <P extends string, I extends Input>(c: Context<E, P, I>) => Response;
	/**
	 * The response when the caller's `Accept` matches nothing the operation offers, a 406.
	 *
	 * Emitted only on routes where the document declares more than one media type for a status, so
	 * a service without content negotiation never sees it. Same shape of hook as {@link noContext}
	 * and admitted on the same test: the status and the `offered` list are contract facts the
	 * generated code already has, but the body they are reported in is the app's envelope, and it
	 * cannot proceed without one. {@link selectContentType} does the choosing; this reports failure.
	 */
	readonly notAcceptable: <P extends string, I extends Input>(
		c: Context<E, P, I>,
		offered: readonly string[],
	) => Response;
	/**
	 * Passed straight to `zValidator`'s hook. Returning `undefined` lets a successful validation
	 * through; returning a `Response` is how a rejection becomes the status this API promises rather
	 * than the middleware's default.
	 */
	readonly invalid: <P extends string, I extends Input>(
		result: { readonly success: boolean },
		c: Context<E, P, I>,
	) => Response | undefined;
	/**
	 * Turn an operation's result into a response, checked against the schema the document publishes
	 * for the arm that applies. A bodyless success is an arm whose `schema` is `undefined`.
	 */
	readonly respond: <P extends string, I extends Input>(
		c: Context<E, P, I>,
		arms: readonly ResponseArm[],
		result: unknown,
	) => Awaitable<Response>;
}
