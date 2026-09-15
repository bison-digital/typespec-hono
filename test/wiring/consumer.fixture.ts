import { Hono, type Context } from "hono";
import { registerRoutes, type Operations } from "../reference/.out/service-wired/app.gen.js";
import {
	ResponseContractError,
	type AppEnv,
	type RouteDeps,
} from "../reference/.out/service-wired/runtime.gen.js";

/**
 * **An application built on both packages, question 3 of three.**
 *
 * **This file exists to be COMPILED, and the compiling is the assertion.** The generated
 * `registerRoutes` signature had never been checked by a typed consumer for most of this emitter's
 * life: the equivalence suite cast the app to `unknown`, so a signature no application could satisfy
 * passed every other test. The first time a real consumer was compiled against it, there were
 * nineteen errors.
 *
 * **It uses the runtime the emitter WROTE, and substitutes nothing.** Its environment is an
 * augmentation of `AppEnv`, its caller context is whatever `deps.context` returns, and its handlers
 * return declared failures as well as successes. Each of those used to need a hand-maintained module
 * replacing the emitted runtime.
 *
 * **Nothing here casts.** A cast anywhere in this file would hide exactly the defect it exists to
 * find. If a handler cannot be written without one, the emitted signature is wrong.
 *
 * **The handler factory is deliberately UNANNOTATED.** Annotating it widens the value to
 * `Operations`, so `T` infers as `Operations`, `Exclude<keyof T, keyof Operations>` is `never`, and
 * the surplus-key refusal evaporates. That is not a hypothetical: an exported `HandlersFor` alias
 * once did precisely this and silently disabled the exhaustiveness check sitting beside it.
 */

declare module "../reference/.out/service-wired/runtime.gen.js" {
	interface AppEnv {
		readonly Bindings: { readonly TENANT?: string };
		readonly Variables: { readonly requestId: string };
	}
}

/** What `deps.context` establishes, and therefore what every handler receives. */
interface Caller {
	readonly accountId: string;
	readonly scopes: readonly string[];
}

/** Proof the augmentation reached the environment: a binding read off `c.env` with no cast. */
export const tenantOf = (c: Context<AppEnv>): string | undefined => c.env.TENANT;

/** A handful of fixed values. This is a wiring proof, not a data layer. */
const widget = {
	id: "w-1",
	name: "Widget",
	weight: 3,
	colour: "red" as const,
	tags: ["a", "b"],
};

/**
 * Written as an object literal so the excess-property check applies: a key for an operation the spec
 * no longer declares is refused here, which is the change the type system otherwise misses entirely.
 * `satisfies` keeps each status a literal, which is what selects the response it belongs to.
 */
const operations = {
	readWidget: (_ctx: Caller, input) => {
		// The wire names, not the TypeSpec property names, proof the validator keys on what arrives.
		void input["x-request-id"];
		return input["widget-id"] === "missing"
			? { status: 404, body: { code: "no-such-widget" } }
			: { status: 200, body: widget };
	},
	listWidgets: (_ctx: Caller, input) => {
		// `?tags=a,b,c` arrives as ONE string and reaches here as an array, because the emitted
		// validator undoes the flattening the document's `style` describes.
		void input.tags;
		return { status: 200, body: [widget] };
	},
	createWidget: (_ctx: Caller, input) => ({ status: 201, body: input }),
	deleteWidget: (_ctx: Caller, _input) => ({ status: 204 }),
	/**
	 * `widgetExists` is `@head`. Registered under GET and told apart by `c.req.method`, and Hono
	 * strips the response body itself -- so the handler returns the bodyless success the document
	 * declares and does not have to know it is a HEAD at all.
	 */
	widgetExists: (_ctx: Caller, _input) => ({ status: 204 }),
	/**
	 * **Every response the document declares for `setFlags`, returned rather than thrown**: the
	 * success, the exact `404`, a status inside the `4XX` range, and one the `default` arm governs. The
	 * revision the caller sends picks which, so each one can be requested.
	 */
	setFlags: (_ctx: Caller, input) => {
		switch (input.revision) {
			case 404:
				return { status: 404, body: { code: "no-such-widget" } };
			case 429:
				return { status: 429, body: { retryAfter: 30 } };
			case 503:
				return { status: 503, body: { reason: "maintenance" } };
			case 1:
				// Every property is the right TYPE, and `name` breaks the `@minLength(1)` the document
				// publishes: a body only the served-body check can refuse.
				return { status: 200, body: { ...widget, name: "" } };
			default:
				return { status: 200, body: widget };
		}
	},
	addShape: (_ctx: Caller, input) => ({ status: 200, body: input }),
	addTree: (_ctx: Caller, input) => ({
		status: 200,
		body: { node: input, attributes: {}, open: { id: "o-1" }, typed: { id: "t-1" } },
	}),
	health: (_ctx: Caller) => ({ status: 200, body: { status: "ok" } }),
	Report_asJson: (_ctx: Caller, _input) => ({ status: 200, body: widget }),
	Report_asText: (_ctx: Caller, _input) => ({ status: 200, body: "plain text" }),
} satisfies Operations<Caller>;

/**
 * What an application supplies. Every hook here answers a question the generated code genuinely
 * cannot: how to build a caller context, and what a refusal looks like.
 */
export const deps: RouteDeps<AppEnv, Caller> = {
	authorize: () => async (_c, next) => {
		await next();
	},
	context: (_c, caller) =>
		caller === "none"
			? { accountId: "anonymous", scopes: [] }
			: { accountId: "acct-1", scopes: [] },
	noContext: (c) => c.json({ error: "no caller" }, 401),
	notAcceptable: (c, offered) => c.json({ error: "not acceptable", offered }, 406),
	invalid: (result, c) => (result.success ? undefined : c.json({ error: "invalid" }, 400)),
};

export function buildApp(): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	/**
	 * **A body the document forbids is the application's to answer, in `onError`**, which is where
	 * Hono puts that decision. The generated route throws rather than choosing a status for it.
	 */
	app.onError((error, c) =>
		error instanceof ResponseContractError
			? c.json(
					{ error: "response-contract", operationId: error.operationId, status: error.status },
					500,
				)
			: c.json({ error: "internal" }, 500),
	);
	// Unannotated on purpose, see the docblock above.
	const handlersFor = () => operations;
	registerRoutes(app, handlersFor, deps);
	return app;
}
