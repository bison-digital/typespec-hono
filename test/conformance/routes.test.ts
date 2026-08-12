import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
	compileScenario,
	depthSources,
	discoverScenarios,
	type CompiledScenario,
} from "./corpus.js";

/**
 * **The route surface, over a corpus we did not write.**
 *
 * The validators are graded in `typespec-http-zod`, against the document, keyword for keyword. What
 * cannot be graded there is whether a caller can REACH any of it: that is a property of a router, and
 * it belongs to the emitter that writes one.
 *
 * ⚠️ **Counts come from `app.routes`, never from the emitted text**, and the difference is not
 * pedantry. Three defects lived in exactly that gap:
 *
 * - a hyphenated path parameter mounted at the literal string `/things/{thing-id}` — emitted, counted
 *   by every text-reading arm, and answering 404 to the only requests it existed for;
 * - `app.on` called without a method, so `HEAD` and `OPTIONS` routes were emitted, counted, and
 *   mounted nowhere;
 * - content negotiation registering every operation on one slot, where a router matches the first, so
 *   each one after it was dead code that looked mounted.
 *
 * ⚠️ **And the emitted server is IMPORTED, which nothing did for a long time.** The validators were
 * loaded and the server never was, so a spec with two same-named operations in different interfaces
 * produced a file declaring the same `const` twice — output that did not parse, passing every test.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

let sources: CompiledScenario[] = [];

beforeAll(async () => {
	const collected: CompiledScenario[] = [];
	for (const scenario of [...discoverScenarios(), ...depthSources()]) {
		try {
			collected.push(await compileScenario(scenario));
		} catch (thrown) {
			collected.push({
				scenario,
				serverDir: "",
				openapiDir: "",
				failure: { owner: "ours", code: "harness", detail: String(thrown).slice(0, 120) },
			});
		}
	}
	sources = collected;
}, 900_000);

/** Operations the document declares, counting a path item's verbs and nothing else. */
function operationsInDocument(document: unknown): number {
	const paths = (document as { paths?: Record<string, Record<string, unknown>> }).paths ?? {};
	let total = 0;
	for (const item of Object.values(paths)) {
		for (const verb of Object.keys(item)) {
			if (verb !== "parameters") total++;
		}
	}
	return total;
}

interface Measured {
	readonly name: string;
	readonly declared: number;
	readonly mounted: number;
	readonly registrations: number;
	/** Operations this emitter named a refusal for, and therefore did not mount. */
	readonly refused: number;
}

async function measure(compiled: CompiledScenario): Promise<Measured | undefined> {
	if (compiled.failure !== undefined) return undefined;
	const documents = readdirSync(compiled.openapiDir).filter((name) => name.endsWith(".json"));
	const chosen =
		compiled.latestVersion === undefined
			? documents.toSorted().at(-1)
			: (documents.find((name) => name === `openapi.${compiled.latestVersion}.json`) ??
				documents.toSorted().at(-1));
	if (chosen === undefined) return undefined;
	const document: unknown = JSON.parse(readFileSync(join(compiled.openapiDir, chosen), "utf8"));

	const server = (await import(join(compiled.serverDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	const app = new Hono();
	const noop = (): undefined => undefined;
	server.registerRoutes(
		app,
		() => new Proxy({}, { get: () => noop }),
		new Proxy({}, { get: () => noop }),
	);
	const slots = new Set(
		app.routes.filter((route) => route.method !== "ALL").map((r) => `${r.method} ${r.path}`),
	);
	const registrations = [
		...readFileSync(join(compiled.serverDir, "app.gen.ts"), "utf8").matchAll(/^\t\w+\.(?!route\()\w+\(/gm),
	].length;
	return {
		name: compiled.scenario.name,
		declared: operationsInDocument(document),
		mounted: slots.size,
		registrations,
		refused: compiled.refusals?.length ?? 0,
	};
}

describe("the generated server mounts what the document declares", () => {
	let measured: Measured[] = [];

	beforeAll(async () => {
		const all = await Promise.all(sources.map(measure));
		measured = all.filter((entry): entry is Measured => entry !== undefined);
	}, 900_000);

	it("records what it measured, so coverage cannot shrink unnoticed", () => {
		/**
		 * ⚠️ **A baseline, because "all green" is not a coverage claim.** Sixty-two baselined divergences
		 * once sat on top of 284 silently dropped operations, because nothing counted routes. The totals
		 * below are the answer to "how much did this actually look at", and they may only grow.
		 */
		const totals = {
			scenarios: measured.length,
			declared: measured.reduce((sum, entry) => sum + entry.declared, 0),
			mounted: measured.reduce((sum, entry) => sum + entry.mounted, 0),
			registrations: measured.reduce((sum, entry) => sum + entry.registrations, 0),
			refused: measured.reduce((sum, entry) => sum + entry.refused, 0),
		};
		const recorded = JSON.parse(
			readFileSync(join(here, "baseline.json"), "utf8"),
		) as typeof totals;
		if (process.env["UPDATE_ROUTE_BASELINE"] === "1") {
			writeFileSync(join(here, "baseline.json"), `${JSON.stringify(totals, null, "\t")}\n`);
			return;
		}
		/**
		 * ⚠️ **The polarities differ on purpose.** Scenarios, declared operations and mounted routes may
		 * only GROW — a corpus bump adds material and a regression removes it. Refusals may only SHRINK:
		 * a new one is an operation this emitter has stopped serving, which is a claim that has to be
		 * justified in a commit rather than absorbed by a number.
		 */
		expect(totals.scenarios, JSON.stringify(totals)).toBeGreaterThanOrEqual(recorded.scenarios);
		expect(totals.declared, JSON.stringify(totals)).toBeGreaterThanOrEqual(recorded.declared);
		expect(totals.mounted, JSON.stringify(totals)).toBeGreaterThanOrEqual(recorded.mounted);
		expect(totals.refused, JSON.stringify(totals)).toBeLessThanOrEqual(recorded.refused);
		// The arithmetic that makes an exclusion visible rather than cancelling out.
		expect(totals.mounted + totals.refused, JSON.stringify(totals)).toBe(totals.declared);
	});

	it("read a real share of the corpus", () => {
		/**
		 * Non-vacuity, and the reason every arm below needs one: a harness that silently stops
		 * resolving `app.gen.ts` reports perfect agreement about nothing. Every number here is zero on
		 * an empty list.
		 */
		expect(discoverScenarios().length).toBeGreaterThanOrEqual(65);
		expect(measured.length).toBeGreaterThanOrEqual(55);
		expect(measured.reduce((total, entry) => total + entry.mounted, 0)).toBeGreaterThanOrEqual(500);
	});

	it("mounts every operation the document declares", () => {
		/**
		 * ⚠️ **Mounted may EXCEED declared, and only the other direction is a defect.** OpenAPI merges
		 * operations that share a route and negotiate on content type into one path item, so a
		 * negotiated scenario legitimately has more slots than the document has entries — except this
		 * emitter collapses those onto one registration, so in practice they agree. A shortfall is an
		 * operation a caller cannot reach at all.
		 *
		 * ⚠️ **Refusals are added back, and that is what makes this honest rather than lenient.** An
		 * operation this emitter names a refusal for is one it declines to serve, out loud; an operation
		 * that simply vanishes is the defect. `mounted + refused === declared` distinguishes them, where
		 * `mounted === declared` could be satisfied by emitting an unreachable route — which is exactly
		 * what happened for fifteen HEAD operations.
		 */
		const short = measured
			.filter((entry) => entry.mounted + entry.refused < entry.declared)
			.map(
				(entry) =>
					`${entry.name}: document=${entry.declared} mounted=${entry.mounted} refused=${entry.refused}`,
			);
		expect(short.toSorted()).toEqual([]);
	});

	it("registers nothing it cannot reach", () => {
		/**
		 * ⚠️ **One `app.<verb>(` per distinct verb+path slot.** Anything more is a handler the router
		 * can never reach, because it matches in registration order.
		 *
		 * Counted from the SOURCE, because `app.routes` cannot answer it: Hono lists one entry per
		 * middleware as well as per handler, all sharing the slot, so a duplicate registration is
		 * indistinguishable from a validator once de-duplicated — and de-duplicating is what the slot
		 * count has to do. A control caught exactly that: disabling the grouping reintroduced the
		 * defect and a slot-only arm stayed green.
		 */
		const unreachable = measured
			.filter((entry) => entry.registrations !== entry.mounted)
			.map(
				(entry) =>
					`${entry.name}: ${entry.registrations} registrations onto ${entry.mounted} slots`,
			);
		expect(unreachable.toSorted()).toEqual([]);
	});

	it("mounts no route still carrying a path template", () => {
		/**
		 * ⚠️ **A route mounted at the literal `/things/{thing-id}` is reachable by nobody**, and every
		 * count reads it as present. This is the arm that would have caught it.
		 */
		const literal: string[] = [];
		for (const compiled of sources) {
			if (compiled.failure !== undefined) continue;
			const source = readFileSync(join(compiled.serverDir, "app.gen.ts"), "utf8");
			for (const match of source.matchAll(/^\t\t"([^"]*\{[^"]*)",$/gm)) {
				literal.push(`${compiled.scenario.name}: ${match[1]}`);
			}
		}
		expect(literal.toSorted()).toEqual([]);
	});

	it("raises no warning of its own", () => {
		/**
		 * A warning from this emitter means "the output is knowingly not what the document says, and we
		 * are shipping it anyway". There was one such warning for exactly one commit, marking an
		 * injected discriminator, and it was the wrong answer — a custom track with a label on it.
		 */
		const warnings = sources.flatMap((compiled) => compiled.emitterWarnings ?? []);
		expect(warnings.toSorted()).toEqual([]);
	});

	it("fails only where the library refuses, and never with a crash", () => {
		/**
		 * ⚠️ **`oracle` failures are not ours and must never be counted as ours.** `routes` is refused by
		 * `@typespec/openapi3` itself (OpenAPI cannot express a path containing a query string) and
		 * `special-words` crashes it. Folding those into one number is how a corpus starts lying: it
		 * would move when Microsoft fix their emitter and nobody would know whether we had regressed.
		 */
		const ours = sources
			.filter((compiled) => compiled.failure?.owner === "ours")
			.map((compiled) => `${compiled.scenario.name} :: ${compiled.failure?.code}`);
		/**
		 * ⚠️ **Refusals are asserted as a CLASS, not a list of scenario names.** Which corpus scenarios
		 * happen to declare a `@head` operation is not a fact about this emitter, and pinning the list
		 * would turn a corpus bump into a spurious failure. What IS a fact: every refusal this emitter
		 * raises is one of the two it declares, and no scenario is refused for an unnamed reason.
		 */
		const refusalCodes = [...new Set(sources.flatMap((compiled) => compiled.refusals ?? []))];
		expect(refusalCodes.toSorted()).toEqual(["typespec-hono/unroutable-verb"]);
		expect(sources.filter((compiled) => (compiled.refusals?.length ?? 0) > 0).length).toBeGreaterThanOrEqual(7);
		/**
		 * Every one of these is a REFUSAL raised by `typespec-http-zod`, reached through this emitter
		 * because it runs the library. This package adds exactly one refusal of its own —
		 * `unsupported-path-template` — and no corpus scenario triggers it.
		 */
		expect(ours.toSorted()).toEqual([
			"response/status-code-range :: typespec-http-zod/unsupported-status-code-range",
			"type/property/value-types :: typespec-http-zod/unsupported-type",
			"type/union/discriminated :: typespec-http-zod/undeclared-discriminator",
		]);
		expect(ours.filter((entry) => entry.includes("crashed"))).toEqual([]);
	});
});
