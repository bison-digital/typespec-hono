import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { RegExpRouter } from "hono/router/reg-exp-router";
import { beforeAll, describe, expect, it } from "vitest";
import {
	compileScenario,
	depthSources,
	discoverScenarios,
	type CompiledScenario,
} from "./corpus.js";

/**
 * **What the compile SAYS about `RegExpRouter` is what `RegExpRouter` does.**
 *
 * `docs/cloudflare-workers.md` used to tell every consumer to construct their app with a bare
 * `RegExpRouter`. Nothing ever mounted a generated server under one: every oracle in this repository
 * builds `new Hono()`, which is `SmartRouter`, and `SmartRouter` catches `UnsupportedPathError` and
 * falls back to `TrieRouter`. So the one router the documentation recommended was the one router
 * never tested, and it refuses a static path segment beside a path parameter at the same position -
 * `/users/me` next to `/users/{id}`, the commonest shape in REST. It throws from `registerRoutes`,
 * which runs at module scope, so the Worker does not start and every route answers nothing.
 *
 * The emitter now answers that question at compile time, with `regexp-router-unsupported`. This is
 * the arm that keeps the answer honest: **the claim and the router must agree, scenario by
 * scenario**. A check that quietly stopped firing would otherwise look exactly like a clean corpus.
 *
 * Two directions, and both matter:
 *
 * - a scenario the compile called unsupported must really throw here, or the warning is noise that
 *   pushes consumers off a faster router for nothing;
 * - a scenario the compile passed must really mount, or the warning is worse than absent - it is a
 *   promise of safety that is not kept, and the failure it misses is a dead service.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const outRoot = join(here, ".out-router");

let compiled: readonly CompiledScenario[] = [];

beforeAll(async () => {
	const collected: CompiledScenario[] = [];
	for (const scenario of [...discoverScenarios(), ...depthSources()]) {
		collected.push(await compileScenario(scenario, outRoot));
	}
	compiled = collected;
}, 900_000);

/** Mount a generated server under a bare `RegExpRouter`, the way the old documentation advised. */
async function mountsUnderRegExpRouter(serverDir: string): Promise<boolean> {
	const server = (await import(join(serverDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => Hono;
	};
	const noop = (): undefined => undefined;
	try {
		const app = server.registerRoutes(
			new Hono({ router: new RegExpRouter() }),
			() => new Proxy({}, { get: () => noop }),
			new Proxy({}, { get: () => noop }),
		);
		/** `RegExpRouter` builds lazily, so registration alone can hide a conflict until the first request. */
		app.router.match("GET", "/");
		return true;
	} catch {
		return false;
	}
}

describe("the compile's RegExpRouter verdict is the router's own", () => {
	it("agrees for every scenario in the corpus", async () => {
		const disagreements: string[] = [];
		let unsupported = 0;
		let checked = 0;
		for (const scenario of compiled) {
			/**
			 * **A scenario openapi3 refuses is still judged here.** Which router can hold a route set is
			 * a question about the generated server, not about the document, and `routes` - the one
			 * corpus scenario `RegExpRouter` cannot compile - is exactly the scenario openapi3 rejects.
			 * Skipping document failures made this arm compare nothing and pass.
			 */
			if (!existsSync(join(scenario.serverDir, "app.gen.ts"))) continue;
			checked++;
			const warned = (scenario.routerUnsupported ?? 0) > 0;
			if (warned) unsupported++;
			const mounts = await mountsUnderRegExpRouter(scenario.serverDir);
			if (warned === mounts) {
				disagreements.push(
					warned
						? `${scenario.scenario.name}: the compile warned, but RegExpRouter mounted it`
						: `${scenario.scenario.name}: the compile was silent, but RegExpRouter threw`,
				);
			}
		}
		expect(disagreements, disagreements.join("\n")).toEqual([]);
		/**
		 * Floors, because an oracle that compares nothing agrees with everything. Both directions have
		 * to be exercised: a corpus where nothing is unsupported would pass this arm with the check
		 * deleted.
		 */
		expect(checked).toBeGreaterThanOrEqual(50);
		expect(unsupported).toBeGreaterThanOrEqual(1);
	});
});
