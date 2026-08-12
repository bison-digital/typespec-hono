/**
 * **Hono's RPC client, against the server this emitter generates.**
 *
 * ⚠️ **This was categorically impossible until the generated registrations were chained.** `hc<T>`
 * derives its entire surface from the `Schema` type parameter Hono accumulates through chaining —
 * `app.get(…).post(…)` — and not from what is registered at run time. The emitter wrote each
 * registration as a separate statement and `registerRoutes` returned `void`, so every route's type
 * was discarded. Measured in a fresh project installed from tarballs: `hc<typeof app>` resolved to
 * **`unknown`**, so the client was not merely empty but unusable, and one of Hono's headline features
 * was unavailable to anything this emitter produced.
 *
 * ⚠️ **The shape was never the obstacle.** A hand-written app with the same sub-app-per-resource
 * arrangement, mounted with `app.route()`, supports `hc` perfectly — proved before changing anything.
 * Only the statements were.
 *
 * This file is compiled by `wiring.test.ts` and never executed: every assertion it makes is a type,
 * and a type that stops holding is a compile error rather than a failing expectation.
 */
import { Hono } from "hono";
import { hc } from "hono/client";
import { registerRoutes } from "../reference/.out/service-wired/app.gen.js";
import type { AppEnv, RouteDeps } from "./runtime.fixture.js";

declare const deps: RouteDeps;
declare const handlers: never;

const routes = registerRoutes(new Hono<AppEnv>(), () => handlers, deps);

/**
 * ⚠️ **`typeof routes`, not `typeof app`.** The chain is the thing that carries the schema; the bare
 * instance passed in still carries nothing, which is exactly why the return value has to be used.
 */
const client = hc<typeof routes>("http://localhost");

/** A route the reference service declares, called with the parameters the document publishes. */
export async function readsAWidget(): Promise<unknown> {
	const response = await client.widgets[":widget-id"].$get({
		param: { "widget-id": "w-1" },
		query: {},
		header: { "x-request-id": "r-1" },
	});
	return response.json();
}

/**
 * ⚠️ **The negative half, and without it the arm above proves only that something compiled.** A
 * client that typed every route as `any` would satisfy `readsAWidget` and catch nothing. This asserts
 * the client REFUSES a call the document does not permit.
 */
export async function refusesAnUndeclaredRoute(): Promise<unknown> {
	// @ts-expect-error — the service declares no `/nonexistent`, and the client has to know it.
	return client.nonexistent.$get();
}
