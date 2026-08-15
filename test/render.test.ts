import { describe, expect, it } from "vitest";
import type { EmittedRoute, EmittedService, RouteSchemaNames } from "typespec-http-zod";
import { renderApp, toHonoPath } from "../src/app.js";

/**
 * **The renderer, exercised directly where no spec can reach it.**
 *
 * **`app.on(method, ...)` is reachable in principle and by no TypeSpec spec.** `@typespec/http`
 * declares six verbs; five have a dedicated Hono helper, and the sixth is `@head`, which this emitter
 * refuses because Hono rewrites HEAD to GET before matching. So the fallback branch is correct,
 * defensive, and (until this file) taken by nothing.
 *
 * A branch nothing reaches is a branch nobody knows is broken. Deleting it instead would be worse:
 * `HONO_METHOD[verb]` would be `undefined` for any verb TypeSpec adds later, and the emitted call
 * would be `app.undefined(...)`, output that does not run, from a spec that compiles.
 *
 * **Measured, not assumed:** `on("PURGE", ...)` and `on("OPTIONS", ...)` both dispatch correctly on
 * Hono 4.13.1. The fallback is the right shape for a verb Hono has no helper for; only HEAD is
 * special, and only HEAD is refused.
 */

/**
 * The narrowest `EmittedService` the renderer will accept, everything else is defaulted away.
 *
 * **`satisfies`, never `as`, and the difference is a whole direction of drift.** This was
 * `as EmittedRoute`, which is an assertion: excess-property checking never runs, so the fixture kept
 * a `paramsSchema: undefined` line for as long as it took somebody to notice, inert, and invisible
 * to `tsc`. An assertion catches the interface GAINING a field (insufficient overlap) and is blind to
 * it LOSING one, which is exactly the change a consumer feels and the compiler could have caught.
 *
 * `satisfies` checks the literal against the type without widening it, so both directions fail here:
 * a field removed from `EmittedRoute` leaves a surplus key, and one added leaves a missing property.
 */
function serviceWith(
	route: Partial<EmittedRoute> & { operationId: string; verb: string },
): EmittedService {
	const full = {
		bodyProperty: undefined,
		optionalBody: false,
		reservedPathParameters: [],
		responseHeaders: [],
		responseMediaTypes: [],
		statusCode: 200,
		statusCodes: [200],
		responseContentTypes: ["application/json"],
		// Added when the request media type became readable; the fixture never supplied it, and
		// `as` hid that for as long as it took to switch to `satisfies`.
		requestContentTypes: ["application/json"],
		summary: undefined,
		requestSchema: undefined,
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
		statusSelector: undefined,
		alternateResponseSchema: undefined,
		path: "/thing",
		...route,
	} satisfies EmittedRoute;
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
			regenerateHint: undefined,
		},
	};
}

const noRefusals = {
	unsupportedPathTemplate: (): void => {
		throw new Error("unexpected path refusal");
	},
	unvalidatableMediaType: (): void => {
		throw new Error("unexpected media-type refusal");
	},
};

describe("a verb with no dedicated Hono helper goes through `app.on(method, ...)`", () => {
	it("passes the METHOD first, which is the whole defect this branch once had", () => {
		/**
		 * **`app.on` was once called WITHOUT a method**, `on(path, handler)` where the signature is
		 * `on(method, path, handler)`. The route was emitted, counted by every arm that counted rows, and
		 * mounted nowhere. The argument ORDER is the assertion, not merely that `on` appears.
		 */
		const source = renderApp(serviceWith({ operationId: "purgeThing", verb: "PURGE" }), noRefusals);
		expect(source).toMatch(/\t\t\.on\(\n\t\t\t"PURGE",\n\t\t\t"\/thing",/);
	});

	it("still uses the dedicated helper where one exists", () => {
		const source = renderApp(serviceWith({ operationId: "getThing", verb: "GET" }), noRefusals);
		expect(source).toMatch(/\t\t\.get\(\n\t\t\t"\/thing",/);
		expect(source).not.toMatch(/\.on\(/);
	});

	it("registers HEAD under GET, guarded, because that is the only verb Hono dispatches", () => {
		const source = renderApp(serviceWith({ operationId: "headThing", verb: "HEAD" }), {
			unsupportedPathTemplate: () => undefined,
			unvalidatableMediaType: () => undefined,
		});
		// Registered under GET, not under a verb Hono rewrites away before matching.
		expect(source).toMatch(/\.get\(/);
		expect(source).not.toMatch(/\.head\(/);
		expect(source).not.toMatch(/\.on\(\s*"HEAD"/);
		/**
		 * The guard is what keeps the registration honest. The document declares no GET on this path,
		 * so a real GET has to get the 404 it would have got if nothing were registered there at all.
		 */
		expect(source).toMatch(/^\t\t\theadOnly,$/m);
		expect(source).toMatch(/import \{ headOnly \} from/);
		// And the operation is actually served, rather than merely registered.
		expect(source).toMatch(/handlersFor\(c\)\.headThing\(/);
	});
});

describe("path templates", () => {
	it("converts every plain parameter, and refuses one that is not", () => {
		const refusals: string[] = [];
		expect(toHonoPath("/a/{id}/b/{other-id}", () => refusals.push("x"))).toBe("/a/:id/b/:other-id");
		expect(refusals).toEqual([]);
		// An RFC 6570 modifier would become part of the name, or, for `*`, Hono's wildcard.
		expect(toHonoPath("/a/{id*}", (_t, name) => refusals.push(name))).toBe("/a/{id*}");
		expect(refusals).toEqual(["id*"]);
	});
});
