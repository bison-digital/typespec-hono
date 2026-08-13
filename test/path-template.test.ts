import { describe, expect, it } from "vitest";
import { renderApp } from "../src/app.js";
import type { EmittedService } from "typespec-http-zod";

/**
 * **What `unsupported-path-template` actually refuses.**
 *
 * This arm exists because the refusal's stated justification was wrong for its whole life. The
 * docblock and the README both claimed an RFC 6570 operator would survive into the parameter name
 * and that `*` would become Hono's wildcard, mounting a route that matched the wrong requests.
 *
 * Measured against the real compiler, that cannot happen. `@typespec/http` resolves the operator
 * before this emitter sees the path, and `@typespec/openapi3` strips it from the published document,
 * so `@route("/files{+path}")` reaches both as `/files{path}` and the two artefacts agree.
 *
 * What DOES reach here is a wire name from `@path("...")`, and only a handful of characters fail.
 * Pinning them is what stops the justification drifting back to a hazard nobody can reproduce.
 */

function serviceWithParameter(name: string): EmittedService {
	return {
		namespace: undefined as never,
		operations: [],
		options: { runtimeModule: "typespec-hono/runtime" },
		routes: [
			{
				operationId: "probe",
				verb: "GET",
				path: `/a/{${name}}`,
				requestContentTypes: [],
				responseContentTypes: [],
				noAuth: true,
			},
		],
		schemaNames: new Map([["probe", { responses: "probeResponses" }]]),
	} as unknown as EmittedService;
}

function refusalsFor(name: string): string[] {
	const refused: string[] = [];
	renderApp(serviceWithParameter(name), {
		unsupportedPathTemplate: (_route, _template, parameter) => refused.push(parameter),
		unvalidatableMediaType: () => undefined,
	});
	return refused;
}

describe("a path parameter name Hono cannot carry", () => {
	it.each([
		["thing-id", "a hyphen, which Hono handles"],
		["thing.id", "a dot, which Hono handles"],
		["thing~id", "a tilde, which Hono handles"],
		["thing_id", "an underscore"],
	])("carries %s verbatim (%s)", (name) => {
		expect(refusalsFor(name)).toEqual([]);
		const source = renderApp(serviceWithParameter(name), {
			unsupportedPathTemplate: () => undefined,
			unvalidatableMediaType: () => undefined,
		});
		expect(source).toContain(`"/a/:${name}"`);
	});

	it.each([
		["thing id", "a space"],
		["thing+id", "a plus"],
		["thing!id", "an exclamation mark"],
	])("refuses %s (%s) and leaves the template literal", (name) => {
		expect(refusalsFor(name)).toEqual([name]);
		const source = renderApp(serviceWithParameter(name), {
			unsupportedPathTemplate: () => undefined,
			unvalidatableMediaType: () => undefined,
		});
		/**
		 * Left as the literal template on purpose. A guessed substitution would mount a route that
		 * matches real requests and answers them wrongly, which is worse than one that matches nothing.
		 */
		expect(source).toContain(`"/a/{${name}}"`);
		expect(source).not.toContain(`"/a/:`);
	});

	it("refuses on the NAME, never on an RFC 6570 operator, because those never arrive", () => {
		/**
		 * The operator forms are resolved upstream, so what this emitter receives is already a plain
		 * `{name}`. Asserting it here keeps the claim in the README honest.
		 */
		expect(refusalsFor("path")).toEqual([]);
		expect(refusalsFor("tag")).toEqual([]);
	});
});
