import type { Context, Env, Input, MiddlewareHandler } from "hono";
import { armFor, type ResponseArm } from "typespec-http-zod/runtime";
export { selectContentType } from "../../src/runtime.js";

/**
 * **What an application puts behind `runtime-module` — written as an application author would.**
 *
 * ⚠️ **This substitutes REAL types, which is the whole point.** The option's purpose is to let an app
 * carry its own environment, caller context and result envelope through every generated signature.
 * Pointed at the package's own runtime it compiles and means nothing: `Result<T>` is `T`, `Ctx` is
 * `unknown`, and the generated `Operations` interface degrades to something any function satisfies.
 * Measured the first time this fixture existed elsewhere: **19 type errors**, and the option whose
 * entire purpose is substitution had never once been pointed at a module that substituted anything.
 *
 * ⚠️ **`ResponseArm` and `armFor` are re-exported from the LIBRARY, not redeclared.** The generated
 * `schemas.gen.ts` annotates its arms with that type, so a substituted module has to supply it —
 * which is exactly how an application discovers that the two packages share one runtime contract.
 */

/** A result envelope of the app's own, so `Result<T>` is no longer the identity. */
export type Result<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly code: string };

export type Awaitable<T> = T | Promise<T>;

/** The app's environment: a binding the generated handlers must carry through untouched. */
export interface AppEnv extends Env {
	readonly Bindings: { readonly BACKEND: { readonly url: string } };
}

/** The app's caller context — concrete, so a handler taking `unknown` no longer compiles. */
export interface Ctx {
	readonly accountId: string;
	readonly scopes: readonly string[];
}

export { armFor, type ResponseArm };

/**
 * The hooks the generated server calls.
 *
 * ⚠️ **Generic over Hono's path and input parameters, deliberately.** Hono narrows `Context` per route
 * — by the literal path, and by whatever the validators on that route produced — so a hook typed
 * against a single `Context<E>` is not assignable at any real call site. Hono's `Context` is also
 * INVARIANT in its environment, because `Context.set` takes `E` as an argument, so re-exporting an
 * unparameterised interface does not work either.
 */
export interface RouteDeps<E extends Env = AppEnv, C = Ctx> {
	readonly authorize: (scopes: readonly string[]) => MiddlewareHandler<E>;
	readonly context: <P extends string, I extends Input>(
		c: Context<E, P, I>,
		caller: "required" | "none",
	) => C | null;
	readonly noContext: <P extends string, I extends Input>(c: Context<E, P, I>) => Response;
	readonly notAcceptable: <P extends string, I extends Input>(
		c: Context<E, P, I>,
		offered: readonly string[],
	) => Response;
	readonly invalid: <P extends string, I extends Input>(
		result: { readonly success: boolean },
		c: Context<E, P, I>,
	) => Response | undefined;
	readonly respond: <P extends string, I extends Input, T>(
		c: Context<E, P, I>,
		arms: readonly ResponseArm[],
		result: Result<T>,
	) => Response;
}
