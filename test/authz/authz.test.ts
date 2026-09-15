import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **The scope gate the document publishes is the gate the generated server applies.**
 *
 * **This is checked on the emitted SOURCE, and it has to be.** Nothing a request can observe
 * distinguishes a server that enforces scopes from one that does not, unless the app's `authorize`
 * happens to reject, and the app is exactly what we are not testing here. The defect it guards
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
		 * **Derived from the emitted routes rather than counted by hand.** A hardcoded number stops
		 * discriminating the moment the fixture grows. It was `2`, the fixture gained two operations,
		 * and the arm failed for a reason that had nothing to do with what it guards.
		 *
		 * The property is a correspondence: one gate per registration, except the `@useAuth(NoAuth)`
		 * one. A generator that gated everything, or nothing, fails this; a fixture that grows does not.
		 */
		// `.route()` mounts a sub-app; it is not a route registration and must not be counted as one.
		const registrations = source.split(/^\t\t\.(?!route\()\w+\(/m).slice(1);
		const gates = source.split("deps.authorize(").length - 1;
		/**
		 * A route needs no gate only when EVERY alternative is anonymous. `deps.context(c, "none")`
		 * alone does not say that: `NoAuth | BearerAuth` takes no context and still names a scheme a
		 * caller may present, so the ungated routes are the ones with no `authorize` in their block.
		 */
		const ungated = registrations.filter((block) => !block.includes("deps.authorize(")).length;
		expect(registrations.length).toBeGreaterThanOrEqual(5);
		expect(ungated).toBe(1);
		expect(gates).toBe(registrations.length - ungated);
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
		 * **The defect this replaced.** `@useAuth(BearerAuth)` publishes
		 * `security: [{ "BearerAuth": [] }]`, and a scopes-only gate saw an empty list and emitted
		 * nothing, so bearer, api-key and basic, which is most services, carried no gate at all and
		 * rested entirely on `deps.context` returning null. That answers "is somebody here", not "did
		 * they satisfy the scheme the contract names": an app reading a cookie would have served a
		 * route the document says needs a bearer token, and nothing would have noticed.
		 */
		expect(source).toContain('deps.authorize([{ "BearerAuth": [] }])');
	});

	it("keeps an anonymous alternative as the empty requirement the document publishes", () => {
		/**
		 * `security: [{}, { "BearerAuth": [] }]`: the empty object is a requirement satisfied by
		 * nothing, so an `authorize` applying the documented rule (any one requirement, every scheme
		 * in it) admits an anonymous caller with no special case. Dropping it demanded the token.
		 */
		expect(source).toContain('deps.authorize([{}, { "BearerAuth": [] }])');
	});

	it("keeps alternatives separate, because either authorises and both is a different claim", () => {
		/**
		 * `@useAuth(A | B)` is an OpenAPI `security` array with two entries: satisfying EITHER
		 * authorises. Flattening them into one requirement would demand both, which is a stricter
		 * contract than the document states, and a flat set of scopes cannot express the difference
		 * at all.
		 */
		expect(source).toMatch(
			/deps\.authorize\(\[\{ "OAuth2Auth": \["widgets:read"\] \}, \{ "BearerAuth": \[\] \}\]\)/,
		);
	});
});

/**
 * **And by request**, against an `authorize` written to the rule `docs/guides.md` states. The source
 * arms above cannot see what a caller sees; this one sends the anonymous request the document accepts.
 */
describe("an anonymous caller where anonymous access is one alternative", () => {
	it("reaches the handler without a credential, and still does with one", async () => {
		const compiled = await compileFixture(here, "guarded", { outName: "guarded-request" });
		const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
			registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
		};
		const { Hono } = await import("hono");
		const app = new Hono();
		type Context = {
			req: { header: (name: string) => string | undefined };
			json: (body: unknown, status: number) => Response;
		};
		const widget = () => ({ status: 200, body: { id: "1" } });
		server.registerRoutes(
			app,
			() => ({
				listWidgets: () => ({ status: 200, body: [{ id: "1" }] }),
				getWidget: widget,
				health: widget,
				auditWidget: widget,
				widgetHistory: widget,
				previewWidget: widget,
			}),
			{
				// The documented rule, and nothing else: any one requirement, every scheme within it.
				authorize:
					(requirements: readonly Record<string, readonly string[]>[]) =>
					async (c: Context, next: () => Promise<void>) => {
						const bearer = (c.req.header("authorization") ?? "").startsWith("Bearer ");
						const ok = requirements.some((requirement) =>
							Object.keys(requirement).every((scheme) => scheme === "BearerAuth" && bearer),
						);
						if (!ok) return c.json({}, 401);
						await next();
						return undefined;
					},
				context: () => ({}),
				noContext: (c: Context) => c.json({}, 401),
				notAcceptable: (c: Context) => c.json({}, 406),
				invalid: (result: { success: boolean }, c: Context) =>
					result.success ? undefined : c.json({}, 400),
			},
		);
		expect((await app.request("/widgets/1/preview")).status).toBe(200);
		expect(
			(await app.request("/widgets/1/preview", { headers: { authorization: "Bearer t" } })).status,
		).toBe(200);
		// Control: a route that requires the token still refuses the same anonymous request.
		expect((await app.request("/widgets/1/audit")).status).toBe(401);
	});
});

/**
 * **`context` is told whether a caller is needed, in the three states the document can say.** It was
 * told `"none"` for `NoAuth | BearerAuth` as well as for `@useAuth(NoAuth)`, so an application could
 * not tell "nobody is expected" from "somebody may be here", and a caller presenting a valid token on
 * an optional route was never established as one. Asked by request, and the expectation is the
 * `security` each operation publishes: none, an anonymous alternative beside a real one, or real only.
 */
describe("the context hook learns whether a caller is none, optional or required", () => {
	it("passes optional where anonymous access is one alternative", async () => {
		const compiled = await compileFixture(here, "guarded", { outName: "guarded-context" });
		const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
			registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
		};
		const { Hono } = await import("hono");
		const app = new Hono();
		type Context = { json: (body: unknown, status: number) => Response };
		const seen: string[] = [];
		const widget = () => ({ status: 200, body: { id: "1" } });
		server.registerRoutes(
			app,
			() => ({
				listWidgets: () => ({ status: 200, body: [{ id: "1" }] }),
				getWidget: widget,
				health: widget,
				auditWidget: widget,
				widgetHistory: widget,
				previewWidget: widget,
			}),
			{
				authorize: () => async (_c: Context, next: () => Promise<void>) => {
					await next();
					return undefined;
				},
				context: (_c: Context, authentication: string) => {
					seen.push(authentication);
					return {};
				},
				noContext: (c: Context) => c.json({}, 401),
				notAcceptable: (c: Context) => c.json({}, 406),
				invalid: (result: { success: boolean }, c: Context) =>
					result.success ? undefined : c.json({}, 400),
			},
		);
		const told = async (path: string) => {
			seen.length = 0;
			expect((await app.request(path)).status, path).toBe(200);
			return seen[0];
		};
		expect(await told("/widgets/1/preview")).toBe("optional");
		expect(await told("/widgets/1/audit")).toBe("required");
		expect(await told("/health")).toBe("none");
	});
});
