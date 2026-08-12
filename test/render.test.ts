import { describe, expect, it } from "vitest";
import type { EmittedRoute, EmittedService, RouteSchemaNames } from "typespec-http-zod";
import { renderApp, toHonoPath } from "../src/app.js";

/**
 * **The renderer, exercised directly where no spec can reach it.**
 *
 * ⚠️ **`app.on(method, …)` is reachable in principle and by no TypeSpec spec.** `@typespec/http`
 * declares six verbs; five have a dedicated Hono helper, and the sixth is `@head`, which this emitter
 * refuses because Hono rewrites HEAD to GET before matching. So the fallback branch is correct,
 * defensive, and — until this file — taken by nothing.
 *
 * A branch nothing reaches is a branch nobody knows is broken. Deleting it instead would be worse:
 * `HONO_METHOD[verb]` would be `undefined` for any verb TypeSpec adds later, and the emitted call
 * would be `app.undefined(...)` — output that does not run, from a spec that compiles.
 *
 * ⚠️ **Measured, not assumed:** `on("PURGE", …)` and `on("OPTIONS", …)` both dispatch correctly on
 * Hono 4.13.1. The fallback is the right shape for a verb Hono has no helper for; only HEAD is
 * special, and only HEAD is refused.
 */

/** The narrowest `EmittedService` the renderer will accept — everything else is defaulted away. */
function serviceWith(route: Partial<EmittedRoute> & { operationId: string; verb: string }): EmittedService {
	const full = {
		statusCode: 200,
		statusCodes: [200],
		responseContentTypes: ["application/json"],
		summary: undefined,
		requestSchema: undefined,
		paramsSchema: undefined,
		pathSchema: undefined,
		querySchema: undefined,
		headerSchema: undefined,
		negotiatedHeaderSchema: undefined,
		accept: undefined,
		responseSchema: undefined,
		rawBodyProperty: undefined,
		errorArms: [],
		noAuth: true,
		scopes: [],
		statusBy: undefined,
		alternateResponseSchema: undefined,
		path: "/thing",
		...route,
	} as EmittedRoute;
	const names: RouteSchemaNames = {
		operationId: full.operationId,
		path: undefined,
		query: undefined,
		header: undefined,
		body: undefined,
		response: undefined,
		alternateResponse: undefined,
		responses: `${full.operationId}Responses`,
	};
	return {
		service: { operations: [], namespace: {} } as unknown as EmittedService["service"],
		routes: [full],
		schemaNames: new Map([[full.operationId, names]]),
		outputDir: "/nowhere",
		options: {
			contractsOutputDir: undefined,
			contractsPackage: undefined,
			sealObjectSchemas: false,
			keyVocabularies: [],
			runtimeModule: "typespec-hono/runtime",
		},
	};
}

const noRefusals = {
	unsupportedPathTemplate: (): void => {
		throw new Error("unexpected path refusal");
	},
	unroutableVerb: (): void => {
		throw new Error("unexpected verb refusal");
	},
};

describe("a verb with no dedicated Hono helper goes through `app.on(method, …)`", () => {
	it("passes the METHOD first, which is the whole defect this branch once had", () => {
		/**
		 * ⚠️ **`app.on` was once called WITHOUT a method** — `on(path, handler)` where the signature is
		 * `on(method, path, handler)`. The route was emitted, counted by every arm that counted rows, and
		 * mounted nowhere. The argument ORDER is the assertion, not merely that `on` appears.
		 */
		const source = renderApp(serviceWith({ operationId: "purgeThing", verb: "PURGE" }), noRefusals);
		expect(source).toMatch(/\tapp\.on\(\n\t\t"PURGE",\n\t\t"\/thing",/);
	});

	it("still uses the dedicated helper where one exists", () => {
		const source = renderApp(serviceWith({ operationId: "getThing", verb: "GET" }), noRefusals);
		expect(source).toMatch(/\tapp\.get\(\n\t\t"\/thing",/);
		expect(source).not.toMatch(/app\.on\(/);
	});

	it("refuses HEAD rather than emitting a route Hono cannot dispatch to", () => {
		const refused: string[] = [];
		const source = renderApp(serviceWith({ operationId: "headThing", verb: "HEAD" }), {
			unsupportedPathTemplate: () => undefined,
			unroutableVerb: (route) => refused.push(route.operationId),
		});
		expect(refused).toEqual(["headThing"]);
		expect(source).not.toMatch(/"HEAD"/);
	});
});

describe("path templates", () => {
	it("converts every plain parameter, and refuses one that is not", () => {
		const refusals: string[] = [];
		expect(toHonoPath("/a/{id}/b/{other-id}", () => refusals.push("x"))).toBe("/a/:id/b/:other-id");
		expect(refusals).toEqual([]);
		// An RFC 6570 modifier would become part of the name — or, for `*`, Hono's wildcard.
		expect(toHonoPath("/a/{id*}", (_t, name) => refusals.push(name))).toBe("/a/{id*}");
		expect(refusals).toEqual(["id*"]);
	});
});
