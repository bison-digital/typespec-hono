import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **The scope gate the document publishes is the gate the generated server applies.**
 *
 * ⚠️ **This is checked on the emitted SOURCE, and it has to be.** Nothing a request can observe
 * distinguishes a server that enforces scopes from one that does not, unless the app's `authorize`
 * happens to reject — and the app is exactly what we are not testing here. The defect it guards
 * against shipped once: the generated app referenced scopes zero times while the published document
 * declared eleven, so a surface mounted with its OAuth gate silently dropped.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("an operation's declared scopes reach the generated server", () => {
	let source: string;
	let compiled: CompiledFixture;

	beforeAll(async () => {
		compiled = await compileFixture(here, "guarded");
		source = readFileSync(join(compiled.outDir, "app.gen.ts"), "utf8");
	});

	it("compiles without an error diagnostic", () => {
		expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	});

	it("gates the scoped operation with exactly the scopes the spec declares", () => {
		expect(source).toContain('deps.authorize([{ "OAuth2Auth": ["widgets:read"] }])');
	});

	it("gates every operation the document secures, and only those", () => {
		/**
		 * ⚠️ **Derived from the emitted routes rather than counted by hand.** A hardcoded number stops
		 * discriminating the moment the fixture grows — it was `2`, the fixture gained two operations,
		 * and the arm failed for a reason that had nothing to do with what it guards.
		 *
		 * The property is a correspondence: one gate per registration, except the `@useAuth(NoAuth)`
		 * one. A generator that gated everything, or nothing, fails this; a fixture that grows does not.
		 */
		// `.route()` mounts a sub-app; it is not a route registration and must not be counted as one.
		const registrations = (source.match(/^\t\t\.(?!route\()\w+\(/gm) ?? []).length;
		const gates = source.split("deps.authorize(").length - 1;
		const unsecured = (source.match(/deps\.context\(c, "none"\)/g) ?? []).length;
		expect(registrations).toBeGreaterThanOrEqual(4);
		expect(unsecured).toBe(1);
		expect(gates).toBe(registrations - unsecured);
	});

	it("puts the gate BEFORE the validators", () => {
		/**
		 * A caller without the scope must be refused whatever their body looks like. Validating first
		 * answers 400 to a request the contract says is not theirs to make, which tells somebody who
		 * may not call the operation at all which payloads are well-formed.
		 */
		const gate = source.indexOf("deps.authorize(");
		const firstValidator = source.indexOf("zValidator(");
		// Both asserted present first: a `-1` from either would satisfy the comparison and prove
		// nothing, which is why the fixture declares an operation that is scoped AND validated.
		expect(gate).toBeGreaterThan(-1);
		expect(firstValidator).toBeGreaterThan(-1);
		expect(gate).toBeLessThan(firstValidator);
	});

	it("carries the scheme even when it declares no scopes", () => {
		/**
		 * ⚠️ **The defect this replaced.** `@useAuth(BearerAuth)` publishes
		 * `security: [{ "BearerAuth": [] }]`, and a scopes-only gate saw an empty list and emitted
		 * nothing — so bearer, api-key and basic, which is most services, carried no gate at all and
		 * rested entirely on `deps.context` returning null. That answers "is somebody here", not "did
		 * they satisfy the scheme the contract names": an app reading a cookie would have served a
		 * route the document says needs a bearer token, and nothing would have noticed.
		 */
		expect(source).toContain('deps.authorize([{ "BearerAuth": [] }])');
	});

	it("keeps alternatives separate, because either authorises and both is a different claim", () => {
		/**
		 * `@useAuth(A | B)` is an OpenAPI `security` array with two entries: satisfying EITHER
		 * authorises. Flattening them into one requirement would demand both, which is a stricter
		 * contract than the document states — and a flat set of scopes cannot express the difference
		 * at all.
		 */
		expect(source).toMatch(
			/deps\.authorize\(\[\{ "OAuth2Auth": \["widgets:read"\] \}, \{ "BearerAuth": \[\] \}\]\)/,
		);
	});
});
