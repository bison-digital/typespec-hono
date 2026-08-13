import { Hono } from "hono";
import { armFor, type AppEnv, type Ctx, type Result, type RouteDeps } from "./runtime.fixture.js";
import { registerRoutes, type Operations } from "../reference/.out/service-wired/app.gen.js";

/**
 * **An application built on both packages, question 3 of three.**
 *
 * **This file exists to be COMPILED, and the compiling is the assertion.** The generated
 * `registerRoutes` signature had never been checked by a typed consumer for most of this emitter's
 * life: the equivalence suite cast the app to `unknown`, so a signature no application could satisfy
 * passed every other test. The first time a real consumer was compiled against it, there were
 * nineteen errors, and `runtime-module`, the option whose entire purpose is letting an app
 * substitute its own types, had never once been pointed at a module that substituted anything.
 *
 * **Nothing here casts.** A cast anywhere in this file would hide exactly the defect it exists to
 * find. If a handler cannot be written without one, the emitted signature is wrong.
 *
 * **The handler factory is deliberately UNANNOTATED.** Annotating it widens the value to
 * `Operations`, so `T` infers as `Operations`, `Exclude<keyof T, keyof Operations>` is `never`, and
 * the surplus-key refusal evaporates. That is not a hypothetical: an exported `HandlersFor` alias
 * once did precisely this and silently disabled the exhaustiveness check sitting beside it.
 */

const ok = <T>(value: T): Result<T> => ({ ok: true, value });

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
 */
const operations = {
	readWidget: (_ctx: Ctx, input) => {
		// The wire names, not the TypeSpec property names, proof the validator keys on what arrives.
		void input["widget-id"];
		void input["x-request-id"];
		return ok(widget);
	},
	listWidgets: (_ctx: Ctx, input) => {
		// `?tags=a,b,c` arrives as ONE string and reaches here as an array, because the emitted
		// validator undoes the flattening the document's `style` describes.
		void input.tags;
		return ok([widget]);
	},
	createWidget: (_ctx: Ctx, input) => ok(input),
	deleteWidget: (_ctx: Ctx, _input) => ok(undefined),
	/**
	 * `widgetExists` is `@head`. It used to be absent from `Operations` entirely, because the emitter
	 * refused it: Hono rewrites HEAD to GET before matching, so a route registered under HEAD is
	 * unreachable. It is served now, registered under GET and told apart by `c.req.method`, and Hono
	 * strips the response body itself -- so the handler returns the headers-only success the document
	 * declares and does not have to know it is a HEAD at all.
	 */
	widgetExists: (_ctx: Ctx, _input) => ok(undefined),
	setFlags: (_ctx: Ctx, _input) => ok(widget),
	addShape: (_ctx: Ctx, input) => ok(input),
	addTree: (_ctx: Ctx, input) =>
		ok({ node: input, attributes: {}, open: { id: "o-1" }, typed: { id: "t-1" } }),
	health: (_ctx: Ctx) => ok({ status: "ok" }),
	Report_asJson: (_ctx: Ctx, _input) => ok(widget),
	Report_asText: (_ctx: Ctx, _input) => ok("plain text"),
} satisfies Operations;

/**
 * What an application supplies. Every hook here answers a question the generated code genuinely
 * cannot: how to build a caller context, how to shape a failure, how to serialise a result.
 */
export const deps: RouteDeps = {
	authorize: () => async (_c, next) => {
		await next();
	},
	context: (_c, caller) =>
		caller === "none"
			? ({ accountId: "anonymous", scopes: [] } as Ctx)
			: { accountId: "acct-1", scopes: [] },
	noContext: (c) => c.json({ error: "no caller" }, 401),
	notAcceptable: (c, offered) => c.json({ error: "not acceptable", offered }, 406),
	invalid: (result, c) => (result.success ? undefined : c.json({ error: "invalid" }, 400)),
	/**
	 * **The status is chosen by the app; the schema for it comes from the document.** `armFor`
	 * applies the Responses Object's own precedence. An exact code, then a range, then `default`,
	 * which is the rule an application otherwise re-derives as "the first arm with a status of 400 or more" and
	 * gets wrong on every range.
	 */
	respond: (c, arms, result) => {
		if (!result.ok) {
			const arm = armFor(arms, 404);
			return c.json({ error: result.code, validated: arm?.schema !== undefined }, 404);
		}
		const success = arms.find((entry) => typeof entry.status === "number" && entry.status < 400);
		const status = (success?.status ?? 200) as 200;
		if (result.value === undefined) return c.body(null, 204);
		// The document's own schema for this status, applied to what the app produced.
		const parsed =
			success?.schema === undefined ? result.value : success.schema.parse(result.value);
		return typeof parsed === "string" ? c.text(parsed, status) : c.json(parsed, status);
	},
};

export function buildApp(): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	// Unannotated on purpose, see the docblock above.
	const handlersFor = () => operations;
	registerRoutes(app, handlersFor, deps);
	return app;
}
