import type { Context, Env, Input, MiddlewareHandler } from "hono";
import type { input, output, ZodType } from "zod";

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
	 * The media types this response offers, where the document names MORE than one.
	 *
	 * Absent where it names one, which is what an application already assumes, so "one type" and
	 * "not carried" are the same state rather than two to tell apart. Present, it is the set to
	 * negotiate against: `selectContentType` takes the caller's `Accept` and these.
	 */
	readonly contentTypes?: readonly string[];
	/**
	 * The headers this response declares, as the document publishes them.
	 *
	 * **Two names, because two different things need them.** `name` is the WIRE name, which is what
	 * the response sets; `property` is the name on the value the handler returned, which is where the
	 * value is read from. `@header("x-correlation-id") correlationId: string` is `x-correlation-id`
	 * on the wire and `correlationId` in the result, and they differ for any header with a hyphen.
	 *
	 * Absent where the response declares none.
	 */
	readonly headers?: readonly { readonly name: string; readonly property: string }[];
	readonly when?: {
		readonly property: string;
		/**
		 * **A number too, because a `@statusCode` union selects by the status itself.**
		 *
		 * `model Created { @statusCode statusCode: 200 | 201 }` names the property that chooses, and
		 * its values are the statuses. The discriminator case carries a boolean or string literal off
		 * the body instead; both are the same question - which arm did the handler mean - so both use
		 * this one field.
		 */
		readonly value: boolean | number | string;
	};
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
 * The `zValidator` targets a request BODY can be read from. Hono extracts `"json"` with
 * `c.req.json()` and `"form"` with `c.req.parseBody()`, and those are the only two that read a body.
 */
export type BodyTarget = "json" | "form";

/**
 * The request body, read the way the target says to read it.
 *
 * The same two readers Hono's own `validator` uses, and the same rejection for a body that is not
 * the JSON it claims to be. `parseBody({ all: true })` builds the object Hono's `"form"` target
 * builds: a repeated key and a `key[]` name both become an array, everything else stays a string.
 */
const UNREADABLE = Symbol("a body that is not what its content type claims");

async function readBody(c: Context, target: BodyTarget): Promise<unknown> {
	if (target === "form") return c.req.parseBody({ all: true });
	try {
		return await c.req.json();
	} catch {
		return UNREADABLE;
	}
}

/**
 * The failure a malformed body produces, reported through the app's `invalid` hook like any other.
 *
 * **It used to `throw new HTTPException(400)`, which never reaches that hook.** The response was
 * `text/plain` with a bare message, so an API whose document declares a JSON error envelope answered
 * a shape its own contract forbids - and the app had no way to intervene, because the throw happened
 * before its code ran.
 *
 * Parsing `undefined` against the body's own schema is what produces a real Zod failure, so
 * `deps.invalid` receives the shape it receives for every other rejection rather than a special case
 * it has to know about. A schema that somehow accepts `undefined` still fails here: a body that
 * could not be read is not a body that validated.
 */
async function unreadableResult(schema: ZodType): Promise<{ readonly success: boolean }> {
	const parsed = await schema.safeParseAsync(undefined);
	return parsed.success ? { success: false } : parsed;
}

/**
 * The slot a validated request body is published under, whichever parser produced it.
 *
 * `ValidationTargets` is a closed union in Hono, so a body cannot be given a name of its own. This
 * is the slot the generated code already reads a body from when one media type is declared, so using
 * it for a dispatched body is what keeps the two cases identical downstream.
 */
const BODY_TARGET = "json";

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
 *
 * **The validated body is published under `"json"` whichever parser produced it**, and that is what
 * makes a dispatched route the same shape as every other one downstream. `ValidationTargets` is a
 * closed union in Hono, so there is no seventh name to coin for "the body"; `"json"` is already the
 * slot this emitter reads a body from, and using it here means the handler spreads one
 * `c.req.valid("json")` exactly as it does for a route declaring a single media type.
 *
 * **The alternative was a middleware that publishes under whichever target ran**, and it was worse
 * in two ways that both shipped. `byContentType` was a bare `MiddlewareHandler`, which contributes no
 * `Input` to the chain, so the generated `c.req.valid("json")` did not compile at all
 * (`TS2345: Argument of type '"json"' is not assignable to parameter of type '"header"'`), and the
 * handler's declared input type omitted the body entirely because the body was not among the route's
 * ordinary validators. Publishing to one known slot removes both, rather than typing around them.
 */
export function byContentType<E extends Env, S extends ZodType>(
	schema: S,
	invalid: <P extends string, I extends Input>(
		result: { readonly success: boolean },
		c: Context<E, P, I>,
	) => Response | undefined,
	/**
	 * **A NON-EMPTY list, stated in the type.** The fallback below reads the first branch, and
	 * `branches[0]` on a plain array is `T | undefined`, which was silenced with a cast. A tuple says
	 * the same thing the emitter already guarantees - this middleware is only ever emitted for a route
	 * declaring at least one request media type - and removes the cast rather than typing around it.
	 */
	branches: readonly [
		readonly [mediaType: string, target: BodyTarget],
		...(readonly [mediaType: string, target: BodyTarget])[],
	],
): MiddlewareHandler<E, string, { in: { json: input<S> }; out: { json: output<S> } }> {
	return async (c, next) => {
		const declared = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
		const matched = branches.find(([mediaType]) => mediaType.toLowerCase() === declared);
		const [, target] = matched ?? branches[0];
		/**
		 * **Registered against the body slot whichever parser runs**, so the validated body is
		 * published under one target and the handler reads it exactly as it reads a single-media-type
		 * one. Hono's `validator` is what `@hono/zod-validator` is built on, so this is the same
		 * extraction, the same `HTTPException` on malformed JSON, and the same default rejection.
		 *
		 * **Hono's own `validator` is deliberately not called here.** Its target fixes the reader at
		 * registration time, and the whole point of this function is that the reader is chosen when the
		 * request arrives. What it does instead is reproduce `validator`'s observable behaviour for both
		 * targets: {@link readBody} performs the same two extractions and raises the same
		 * `HTTPException` on malformed JSON, and the rejection below is `zValidator`'s own.
		 *
		 * Annotated rather than inlined because `Context` is invariant in its environment and in its
		 * `Input`. Same reason `RouteDeps` is parameterised.
		 */
		const parse: MiddlewareHandler<
			E,
			string,
			{ in: { json: input<S> }; out: { json: output<S> } }
		> = async (ctx, proceed) => {
			const raw = await readBody(ctx, target);
			const result =
				raw === UNREADABLE ? await unreadableResult(schema) : await schema.safeParseAsync(raw);
			const response = invalid(result, ctx);
			if (response !== undefined) return response;
			// `zValidator`'s own answer when a hook declines to, kept identical so a dispatched route
			// and a single-media-type one reject a bad body the same way.
			if (!result.success) return ctx.json(result, 400);
			ctx.req.addValidatedData(BODY_TARGET, ("data" in result ? result.data : undefined) ?? {});
			await proceed();
			return undefined;
		};
		return parse(c, next);
	};
}

/**
 * Validate a body the document says is OPTIONAL, and let a request carrying none through.
 *
 * **`requestBody.required: false` means a request with no body is one the contract permits**, and a
 * plain `zValidator` refused it. Measured against @hono/zod-validator 0.9.0 and hono 4.12.26: a
 * `POST` with `content-type: application/json` and no body answered **400 `Malformed JSON in request
 * body`** as `text/plain` - raised before the `invalid` hook, so outside the app's error envelope
 * entirely. A service refusing what its own document allows, in a shape that document forbids.
 *
 * **Nothing is published when the body is absent**, so `c.req.valid(...)` reads `undefined` and the
 * handler is told the truth. That is why an optional body is a NAMED property on the input rather
 * than merged into it: a merge has no way to say "these are here only sometimes" without making
 * every one of them optional, which is a weaker and different claim about the body that IS sent.
 *
 * A body that is present but unreadable still fails, through `invalid`, so the app's envelope holds.
 */
export function optionalBody<E extends Env, S extends ZodType>(
	schema: S,
	invalid: <P extends string, I extends Input>(
		result: { readonly success: boolean },
		c: Context<E, P, I>,
	) => Response | undefined,
	target: BodyTarget,
): MiddlewareHandler<
	E,
	string,
	{ in: { json: input<S> | undefined }; out: { json: output<S> | undefined } }
> {
	return async (c, next) => {
		if (!hasBody(c)) {
			await next();
			return undefined;
		}
		const raw = await readBody(c, target);
		const result =
			raw === UNREADABLE ? await unreadableResult(schema) : await schema.safeParseAsync(raw);
		const response = invalid(result, c as never);
		if (response !== undefined) return response;
		if (!result.success) return c.json(result, 400);
		c.req.addValidatedData(BODY_TARGET, ("data" in result ? result.data : undefined) ?? {});
		await next();
		return undefined;
	};
}

/**
 * Whether the request carries a body at all.
 *
 * Both halves are load-bearing. The platform reports `null` for a request sent without one, and a
 * caller may instead send `content-length: 0`, which is a body of no bytes and reads the same way to
 * anything downstream. Neither alone covers what arrives.
 */
function hasBody(c: Context): boolean {
	if (c.req.raw.body === null) return false;
	return (c.req.header("content-length") ?? "").trim() !== "0";
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
