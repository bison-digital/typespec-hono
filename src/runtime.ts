import type { Context, Env, Input, MiddlewareHandler } from "hono";
import type { output, ZodError, ZodType } from "zod";

/**
 * One arm of an operation's declared response set, as the document publishes it.
 *
 * Declared here rather than imported from `typespec-http-zod`, so that this module and the copy the
 * emitter writes beside the generated code are both free of any package import at run time. The two
 * declarations are structurally identical, which is all TypeScript requires, and
 * `test/runtime-parity.test.ts` asserts that this `armFor` answers identically to the library's for
 * every shape of arm list.
 */
export interface ResponseArm {
	readonly status: number | "default" | `${1 | 2 | 3 | 4 | 5}XX`;
	readonly schema: ZodType | undefined;
	/**
	 * Every media type this response offers, including a single one. Absent where there is no body.
	 */
	readonly contentTypes?: readonly string[];
	/**
	 * The headers this response declares, by the WIRE name the response sets. `optional` is the
	 * document's `required: false`. Absent where the response declares none.
	 */
	readonly headers?: readonly { readonly name: string; readonly optional: boolean }[];
}

/**
 * The arm that applies to a status, preferring an exact code, then its `NXX` range, then `default`.
 *
 * That order is the document's own: OpenAPI resolves a response the same way, so an application
 * choosing an arm by hand would have to re-derive this and could get it wrong differently.
 */
export function armFor(arms: readonly ResponseArm[], status: number): ResponseArm | undefined {
	return (
		arms.find((arm) => arm.status === status) ??
		arms.find((arm) => arm.status === `${Math.floor(status / 100) as 1 | 2 | 3 | 4 | 5}XX`) ??
		arms.find((arm) => arm.status === "default")
	);
}

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
 * context, and what a refusal looks like. Everything else, routing, validation, which validator
 * applies to which target, which statuses an operation may answer with and how each one is served,
 * is generated.
 */

/**
 * The Hono environment the generated server mounts on.
 *
 * **An interface, so an application AUGMENTS it rather than replacing this module.**
 *
 * ```ts
 * declare module "./generated/runtime.gen.js" {
 * 	interface AppEnv {
 * 		Bindings: { BACKEND: Service<Backend> };
 * 		Variables: { principal: Principal };
 * 	}
 * }
 * ```
 *
 * That is the idiom Hono itself uses for `ContextVariableMap`, and it is what lets this module be
 * emitted beside the generated code on every compile instead of being copied into an application and
 * aged there. A copy was the only other way to name an environment: a gateway ran a runtime from
 * `0.10.1` while the emitter reached `0.21.0`, carrying a content-negotiation defect fixed eleven
 * releases earlier.
 *
 * **Concrete rather than a type parameter of `registerRoutes`, and that was measured twice.** Hono
 * narrows `Context` per route, and its conditional types cannot reduce
 * `IfAnyThenEmptyObject<E extends Env ? ...>` while `E` is an unbound parameter, so nothing an
 * application supplies is ever assignable and every call site needs a cast. Confirmed again on hono
 * 4.13.1 with TypeScript 7.0.2: three `TS2345`s on a three-route probe.
 */
// oxlint-disable-next-line typescript/no-empty-interface -- augmented by the application.
export interface AppEnv extends Env {}

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
 * - **specificity SELECTS which rule applies, before quality is read at all.** For each offered
 *   type, the most specific range that matches it decides its quality: an exact type beats a
 *   subtype wildcard (`text/*`), which beats the fully wildcard range. The fully wildcard range is
 *   not written literally here because it would close this comment;
 * - **`q=0` is a REFUSAL**, not a weak preference, so a type whose applicable rule scores zero is
 *   never chosen;
 * - equal quality keeps the order the document offers, so nothing in the header displaces it;
 * - a malformed `q` is IGNORED rather than read as zero - a typo should not turn into a 406;
 * - parameters after the media range (`;charset=utf-8`) are not part of the match.
 *
 * **Specificity was implemented as a tie-break and that was wrong three ways at once**, all of them
 * live in a published runtime until `test/negotiation.test.ts` was written. Scoring every matching
 * range and keeping the best `(q, specificity)` pair lets a permissive wildcard out-vote the precise
 * rule a caller wrote about that exact type - so `Accept: *​/*, application/json;q=0` was served
 * JSON, which is the one outcome an explicit refusal must never produce. The prose above stated the
 * right rules the whole time; nothing compared it to the code.
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
		const q = quality === undefined ? 1 : Number(quality);
		// A malformed `q` is treated as unstated. Reading `q=1.2.3` as zero would 406 a typo.
		return { range: range.toLowerCase(), q: Number.isFinite(q) ? q : 1 };
	});

	let best: { type: string; q: number } | undefined;
	for (const type of offered) {
		const lowered = type.toLowerCase();
		const [group] = lowered.split("/");
		/**
		 * **The most specific matching range decides this type's quality**, which is what makes an
		 * explicit `application/json;q=0` beat a wildcard that would otherwise accept it. Reading the
		 * best-scoring range instead lets a permissive rule override a precise one.
		 */
		let applicable: { q: number; specificity: number } | undefined;
		for (const { range, q } of ranges) {
			const specificity =
				range === lowered ? 2 : range === `${group}/*` ? 1 : range === "*/*" ? 0 : -1;
			if (specificity < 0) continue;
			// Strictly greater, so two rules of equal specificity leave the first one in force.
			if (applicable === undefined || specificity > applicable.specificity) {
				applicable = { q, specificity };
			}
		}
		// `q=0` is "I will not accept this", so a type its own rule scores zero is never a candidate.
		if (applicable === undefined || applicable.q <= 0) continue;
		// Strictly greater, so equal quality keeps the order the document offers.
		if (best === undefined || applicable.q > best.q) best = { type, q: applicable.q };
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
 * **A route whose template writes a query string, `/items?fixed=true{&param}`, is only that route when
 * the request carries it.** A router matches paths, so the pairs are checked here, and a request
 * without them gets the 404 any unrouted request gets, through whatever `app.notFound()` the
 * application has set. In the runtime for the same reason as {@link headOnly}.
 */
export const literalQuery =
	(pairs: readonly (readonly [string, string])[]): MiddlewareHandler =>
	async (c, next) =>
		pairs.every(([name, value]) => c.req.query(name) === value) ? next() : c.notFound();

/**
 * A response body that does not match the schema the document publishes for its status.
 *
 * **Thrown, so an application decides what a contract failure answers with in `app.onError`**,
 * which is where Hono puts that decision. Before this existed every consumer made the same check in
 * its own `respond` and answered differently - a 500, a 502, a 502 with the issues in the body, a 502
 * with them redacted - and only one of them checked failure bodies at all.
 *
 * `issues` are Zod's, so they carry paths and codes. They also carry the offending VALUES; an
 * application that logs them should decide whether its responses may contain anything it would not
 * log.
 */
export class ResponseContractError extends Error {
	constructor(
		readonly operationId: string,
		readonly status: number,
		readonly issues: ZodError["issues"],
	) {
		super(`${operationId} answered ${status} with a body its document does not permit`);
		this.name = "ResponseContractError";
	}
}

/**
 * A handler answered with a status its operation does not declare.
 *
 * **Unreachable from a typed handler.** The generated `Operations` interface types every result as
 * the union of the declared statuses, so a literal outside it does not compile. This is what a CAST
 * produces, or a result that crossed a boundary the type system cannot see into, such as untyped
 * data from a service binding. Thrown rather than served, because serving it would publish a status
 * the contract does not state.
 */
export class UndeclaredStatusError extends Error {
	constructor(
		readonly operationId: string,
		readonly result: unknown,
	) {
		const status =
			typeof result === "object" && result !== null && "status" in result
				? String(result.status)
				: "no status";
		super(`${operationId} answered ${status}, which its document does not declare`);
		this.name = "UndeclaredStatusError";
	}
}

/**
 * The body a response SERVES: what the handler returned, parsed against the schema the document
 * publishes for that status.
 *
 * **What is served is the PARSED value, not the one the handler returned.** A schema that strips
 * undeclared keys therefore strips them from the wire too, which is how an internal field such as a
 * tenant id is kept out of a response the document does not publish it in. Seven of the nine
 * consumer surfaces surveyed relied on exactly that, each in its own hand-written `respond`.
 *
 * Synchronous, because nothing this emitter writes is asynchronous - `test/sync.test.ts` asserts it
 * over the whole corpus - and the asynchronous path costs 2.6x per parse.
 */
export function servedBody<S extends ZodType>(
	schema: S,
	value: unknown,
	operationId: string,
	status: number,
): output<S> {
	const parsed = schema.safeParse(value);
	if (!parsed.success) throw new ResponseContractError(operationId, status, parsed.error.issues);
	return parsed.data;
}

/**
 * Declared response headers, as the strings a response carries.
 *
 * An optional header the handler did not supply is omitted rather than sent as `"undefined"`, and a
 * typed value - a `retry-after` declared `int32` - is written as its text. Hono's `HeaderRecord`
 * refuses `undefined`, so dropping it here is also what keeps the generated call sites free of a
 * conditional per header.
 */
export function headersOf(declared: Readonly<Record<string, unknown>>): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(declared)) {
		if (value !== undefined) headers[name] = String(value);
	}
	return headers;
}

/** RFC 9110 `token`, less `*`, which names a range rather than a type. */
const MEDIA_TOKEN = "[!#$%&'+.^_`|~0-9A-Za-z-]+";
const SERVED_MEDIA_TYPE = new RegExp(`^(${MEDIA_TOKEN})/${MEDIA_TOKEN}\\s*(;.*)?$`);

/**
 * Whether a media type a handler answers with lies inside a range the document offers.
 *
 * **A range is not a type a response can be sent as**, so where a status offers `image/*` the handler
 * names the concrete type, and its result type already refuses one outside the range. This is what a
 * CAST reaches, or data from a service binding: `text/html` under `image/*`, or `image/*` itself,
 * would otherwise be served with a `Content-Type` the document does not permit. Type names compare
 * case-insensitively (RFC 9110 section 8.3.1), and parameters such as `charset` are allowed.
 */
export function mediaTypeWithin(served: string, range: string): boolean {
	const type = SERVED_MEDIA_TYPE.exec(served)?.[1];
	if (type === undefined) return false;
	if (range === "*/*") return true;
	return range.endsWith("/*") && type.toLowerCase() === range.slice(0, -2).toLowerCase();
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
 * **`C` is the caller context, and `registerRoutes` INFERS it from `context`.** An application that
 * returns a `Caller` from `context` has handlers typed `(ctx: Caller, input)`, with nothing to
 * declare. It used to be a type an application re-declared in a substituted copy of this module.
 *
 * **Nothing here renders a successful response, and that is the point.** Which statuses an operation
 * may answer with, which body each one carries and how it is serialised are all things the document
 * states, so the generated route does them. A `respond` hook used to be handed every arm and the
 * handler's result, and every application re-implemented the choice by hand: five status-mapping
 * tables across the consumers surveyed, none consulting the arms, one sending a declared 404 as 400.
 * What remains are the refusals that happen before a handler runs, whose envelope only the
 * application knows.
 */
export interface RouteDeps<E extends Env = AppEnv, C = unknown> {
	/**
	 * The gate the DOCUMENT publishes, as middleware.
	 *
	 * **Which scopes an operation demands is a contract fact; how a token is verified is not.**
	 * `@useAuth(OAuth2Auth<...>)` reaches OpenAPI as `security` per operation, so the requirement is
	 * generated and this implements the check. The same split as `context`. Emitted
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
	 * `authentication` is what the DOCUMENT says, and only that:
	 *
	 * - `"none"`: no requirement asks for anything (`@useAuth(NoAuth)`, or no authentication at all);
	 * - `"optional"`: an anonymous alternative sits beside a real one (`NoAuth | BearerAuth`), so
	 *   `authorize` has admitted this caller either way and a presented credential should still be
	 *   read;
	 * - `"required"`: every alternative asks for something.
	 *
	 * **`"optional"` is new, and without it the middle case was reported as `"none"`**, so a caller
	 * with a valid token on an optional route was never established as a caller. Deciding it at
	 * generation time is the point: the gate the document publishes is the gate that runs.
	 *
	 * **It used to be `"none" | "account" | "resource"`, and the last two were an invention.** They
	 * were chosen by whether the path had parameters, which no OpenAPI keyword expresses and which
	 * merely happened to fit the first consumer. A generated server enforcing a rule derived from
	 * nothing published is the defect class this emitter exists to remove, so it is gone. An app that
	 * needs the distinction can read the request, which is the one thing it definitely has.
	 */
	readonly context: <P extends string, I extends Input>(
		c: Context<E, P, I>,
		authentication: "none" | "optional" | "required",
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
}
