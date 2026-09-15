import { describe, expect, it } from "vitest";
import { renderApp, toHonoPath } from "../src/app.js";
import { ignoreRefusals, noRefusals, serviceWith } from "./support/emitted-service.js";

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
		const source = renderApp(
			serviceWith({ operationId: "headThing", verb: "HEAD" }),
			ignoreRefusals,
		);
		// Registered under GET, not under a verb Hono rewrites away before matching.
		expect(source).toMatch(/\.get\(/);
		expect(source).not.toMatch(/\.head\(/);
		expect(source).not.toMatch(/\.on\(\s*"HEAD"/);
		/**
		 * The guard is what keeps the registration honest. The document declares no GET on this path,
		 * so a real GET has to get the 404 it would have got if nothing were registered there at all.
		 */
		expect(source).toMatch(/^\t\t\theadOnly,$/m);
		expect(source).toMatch(/import \{ [^}]*\bheadOnly\b[^}]*\} from/);
		// And the operation is actually served, rather than merely registered.
		expect(source).toMatch(/handlersFor\(c\)\.headThing\(/);
	});
});

describe("path templates", () => {
	const literal = (text: string) => ({ kind: "literal", text }) as const;
	const expression = (parameter: string, rest: Partial<Record<string, unknown>> = {}) =>
		({
			kind: "expression",
			parameter,
			prefix: "",
			suffix: "",
			operator: "",
			explode: false,
			optional: false,
			reserved: false,
			...rest,
		}) as const;

	it("converts every plain parameter, and refuses a name Hono cannot carry", () => {
		const refusals: string[] = [];
		expect(
			toHonoPath([literal("a"), expression("id"), literal("b"), expression("other-id")], () =>
				refusals.push("x"),
			),
		).toBe("/a/:id/b/:other-id");
		expect(refusals).toEqual([]);
		expect(
			toHonoPath([literal("a"), expression("thing id")], (_t, name) => refusals.push(name)),
		).toBe("/a/{thing id}");
		expect(refusals).toEqual(["thing id"]);
	});

	/**
	 * **Every RFC 6570 form mounts as a pattern that matches its whole segment**, measured against
	 * Hono by `test/conformance/uris.test.ts` with the corpus's own URIs. Stated here as the spellings,
	 * so a change to one is a change a reader sees.
	 */
	it("mounts label, matrix, prefixed, reserved, exploding and optional expressions", () => {
		const refuse = () => {
			throw new Error("unexpected refusal");
		};
		expect(toHonoPath([expression("param", { prefix: "array", operator: "." })], refuse)).toBe(
			"/:param{array\\.[^\\x2F]*}",
		);
		expect(toHonoPath([expression("param", { prefix: "record", operator: ";" })], refuse)).toBe(
			"/:param{record;[^\\x2F]*}",
		);
		expect(toHonoPath([expression("param", { prefix: "primitive" })], refuse)).toBe(
			"/:param{primitive[^\\x2F]*}",
		);
		expect(toHonoPath([literal("files"), expression("path", { reserved: true })], refuse)).toBe(
			"/files/:path{.+}",
		);
		expect(
			toHonoPath([literal("array"), expression("param", { operator: "/", explode: true })], refuse),
		).toBe("/array/:param{.+}");
		expect(
			toHonoPath(
				[literal("optional"), expression("name", { operator: "/", optional: true })],
				refuse,
			),
		).toBe("/optional/:name?");
	});

	/**
	 * **A pattern parameter is still a templated segment to the ordering rule**, which reads a mounted
	 * segment as templated when it starts with `:`. A concrete sibling must register first, or Hono's
	 * first-match routing hands its requests to the pattern.
	 */
	it("registers a concrete sibling before a pattern parameter in the same position", () => {
		const concrete = serviceWith({ operationId: "plain", verb: "GET", path: "/items/plain" });
		const pattern = serviceWith({
			operationId: "labelled",
			verb: "GET",
			path: "/items/{id}",
			pathSegments: [
				{ kind: "literal", text: "items" },
				{
					kind: "expression",
					parameter: "id",
					prefix: "item",
					suffix: "",
					operator: ".",
					explode: false,
					optional: false,
					reserved: false,
				},
			],
		});
		const service = {
			...pattern,
			routes: [...pattern.routes, ...concrete.routes],
			schemaNames: new Map([...pattern.schemaNames, ...concrete.schemaNames]),
		};
		const source = renderApp(service, noRefusals);
		const patternAt = source.indexOf(String.raw`"/:id{item\\.[^\\x2F]*}"`);
		const concreteAt = source.indexOf('"/plain"');
		expect(patternAt).toBeGreaterThan(-1);
		expect(concreteAt).toBeGreaterThan(-1);
		expect(concreteAt).toBeLessThan(patternAt);
	});

	it("refuses a segment holding two expressions, which no segment router can split", () => {
		const refusals: string[] = [];
		expect(
			toHonoPath([{ kind: "unsupported", text: "{a}{b}" }], (_t, name) => refusals.push(name)),
		).toBe("/{a}{b}");
		expect(refusals).toEqual(["{a}{b}"]);
	});
});
