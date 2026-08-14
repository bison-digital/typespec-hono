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
 * **Counts come from `app.routes`, never from the emitted text**, and the difference is not
 * pedantry. Three defects lived in exactly that gap:
 *
 * - a hyphenated path parameter mounted at the literal string `/things/{thing-id}`, emitted, counted
 *   by every text-reading arm, and answering 404 to the only requests it existed for;
 * - `app.on` called without a method, so `HEAD` and `OPTIONS` routes were emitted, counted, and
 *   mounted nowhere;
 * - content negotiation registering every operation on one slot, where a router matches the first, so
 *   each one after it was dead code that looked mounted.
 *
 * **And the emitted server is IMPORTED, which nothing did for a long time.** The validators were
 * loaded and the server never was, so a spec with two same-named operations in different interfaces
 * produced a file declaring the same `const` twice, output that did not parse, passing every test.
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

interface OpenApiDocument {
	readonly paths?: Record<
		string,
		Record<
			string,
			{
				readonly security?: readonly Record<string, unknown>[];
				readonly operationId?: string;
				readonly responses?: Record<string, unknown>;
			}
		>
	>;
	readonly security?: readonly Record<string, unknown>[];
	readonly servers?: readonly { readonly url: string }[];
}

interface Measured {
	readonly name: string;
	readonly declared: number;
	/** Operations whose handler the generated file invokes. */
	readonly mounted: number;
	/** Distinct router slots. Lower than `mounted` where GET and HEAD share a path. */
	readonly slots: number;
	/** Distinct operations the file invokes. Exceeds `declared` where negotiation is used. */
	readonly served: number;
	readonly registrations: number;
	/** Operations this emitter named a refusal for, and therefore did not mount. */
	readonly refused: number;
	/** Operations mounted but with a declared media type this emitter cannot validate. */
	readonly partiallyValidated: number;
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
	const source = readFileSync(join(compiled.serverDir, "app.gen.ts"), "utf8");
	const registrations = [...source.matchAll(/^\t\t\.(?!route\()\w+\(/gm)].length;
	/**
	 * A path where the document declares BOTH GET and HEAD is one router slot serving two document
	 * entries: Hono rewrites HEAD to GET before matching, so the two cannot have separate slots, and
	 * the handler tells them apart with `c.req.method`. Counting slots alone undercounts those by one
	 * each, which is what the merge count restores.
	 */
	const headMerges = [...source.matchAll(/if \(c\.req\.method === "HEAD"\) \{/g)].length;
	/**
	 * Distinct operations the file actually invokes. Higher than the document's entry count wherever
	 * content negotiation is used, because TypeSpec models that as several operations against one
	 * OpenAPI path item -- so this is a completeness check, not a term in the arithmetic.
	 */
	const served = new Set([...source.matchAll(/handlersFor\(c\)\.(\w+)\(/g)].map((m) => m[1]));
	return {
		name: compiled.scenario.name,
		declared: operationsInDocument(document),
		mounted: slots.size + headMerges,
		slots: slots.size,
		served: served.size,
		registrations,
		refused: compiled.refusals?.length ?? 0,
		partiallyValidated: compiled.partiallyValidated ?? 0,
	};
}

describe("the generated server mounts what the document declares", () => {
	let measured: Measured[] = [];

	beforeAll(async () => {
		const all = await Promise.all(sources.map(measure));
		measured = all.filter((entry): entry is Measured => entry !== undefined);
	}, 900_000);

	it("grades every scenario that compiled, dropping none of them silently", () => {
		/**
		 * **The arm that stops the previous fix from being un-fixed.**
		 *
		 * Every scenario carrying a refusal used to arrive here with no OpenAPI document, because our
		 * diagnostics are `severity: "error"`, that sets `program.hasError()`, and openapi3 guards on it
		 * before writing anything. Thirteen scenarios were therefore ungradeable, and the route
		 * arithmetic that is this suite's central claim was being computed over the remaining 48 while
		 * reporting totals that could only have come from documents an earlier build left on disk.
		 *
		 * The first attempt at this counted the casualties and pinned the number, which accommodated the
		 * defect instead of removing it. `corpus.ts` now fetches the document openapi3 declined to
		 * write, and this asserts the consequence: a scenario that compiled is a scenario that got
		 * graded. Anything that reintroduces a silent drop fails here by name rather than by a number
		 * quietly drifting.
		 */
		const compiled = sources.filter((source) => source.failure === undefined);
		const gradedNames = new Set(measured.map((entry) => entry.name));
		const dropped = compiled
			.map((source) => source.scenario.name)
			.filter((name) => !gradedNames.has(name))
			.toSorted();
		expect(dropped, `compiled but ungraded: ${dropped.join(", ")}`).toEqual([]);
		// Non-vacuity: the assertion above is trivially satisfied if nothing compiled at all.
		expect(compiled.length).toBeGreaterThanOrEqual(55);
	});

	it("records what it measured, so coverage cannot shrink unnoticed", () => {
		/**
		 * **A baseline, because "all green" is not a coverage claim.** Sixty-two baselined divergences
		 * once sat on top of 284 silently dropped operations, because nothing counted routes. The totals
		 * below are the answer to "how much did this actually look at", and they may only grow.
		 */
		const totals = {
			scenarios: measured.length,
			declared: measured.reduce((sum, entry) => sum + entry.declared, 0),
			mounted: measured.reduce((sum, entry) => sum + entry.mounted, 0),
			slots: measured.reduce((sum, entry) => sum + entry.slots, 0),
			served: measured.reduce((sum, entry) => sum + entry.served, 0),
			registrations: measured.reduce((sum, entry) => sum + entry.registrations, 0),
			refused: measured.reduce((sum, entry) => sum + entry.refused, 0),
			partiallyValidated: measured.reduce((sum, entry) => sum + entry.partiallyValidated, 0),
		};
		const recorded = JSON.parse(readFileSync(join(here, "baseline.json"), "utf8")) as typeof totals;
		if (process.env["UPDATE_ROUTE_BASELINE"] === "1") {
			writeFileSync(join(here, "baseline.json"), `${JSON.stringify(totals, null, "\t")}\n`);
			return;
		}
		/**
		 * **The polarities differ on purpose.** Scenarios, declared operations and mounted routes may
		 * only GROW. A corpus bump adds material and a regression removes it. Refusals may only SHRINK:
		 * a new one is an operation this emitter has stopped serving, which is a claim that has to be
		 * justified in a commit rather than absorbed by a number.
		 */
		expect(totals.scenarios, JSON.stringify(totals)).toBeGreaterThanOrEqual(recorded.scenarios);
		expect(totals.declared, JSON.stringify(totals)).toBeGreaterThanOrEqual(recorded.declared);
		expect(totals.mounted, JSON.stringify(totals)).toBeGreaterThanOrEqual(recorded.mounted);
		expect(totals.refused, JSON.stringify(totals)).toBeLessThanOrEqual(recorded.refused);
		/**
		 * Visible rather than absorbed. These operations ARE mounted and serve every media type this
		 * emitter can parse; the number is how many also declare one it cannot, which today is
		 * `application/xml`. It may only shrink, for the same reason refusals may only shrink.
		 */
		expect(totals.partiallyValidated, JSON.stringify(totals)).toBeLessThanOrEqual(
			recorded.partiallyValidated,
		);
		expect(totals.slots, JSON.stringify(totals)).toBeGreaterThanOrEqual(recorded.slots);
		// The arithmetic that makes an exclusion visible rather than cancelling out.
		expect(totals.mounted + totals.refused, JSON.stringify(totals)).toBe(totals.declared);
		/**
		 * Every registration reaches a slot the router will dispatch to. Registrations may exceed slots
		 * -- content negotiation puts several operations on one, and a GET and a HEAD share one -- but a
		 * slot count BELOW the registration count minus those merges would mean text in the file that
		 * `app.routes` never lists, which is the phantom-route defect this suite exists for.
		 */
		expect(totals.slots, JSON.stringify(totals)).toBeGreaterThan(0);
		// Every operation the emitter kept is invoked by the file it wrote.
		expect(totals.served, JSON.stringify(totals)).toBeGreaterThanOrEqual(recorded.served);
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
		 * **Mounted may EXCEED declared, and only the other direction is a defect.** OpenAPI merges
		 * operations that share a route and negotiate on content type into one path item, so a
		 * negotiated scenario legitimately has more slots than the document has entries, except this
		 * emitter collapses those onto one registration, so in practice they agree. A shortfall is an
		 * operation a caller cannot reach at all.
		 *
		 * **Refusals are added back, and that is what makes this honest rather than lenient.** An
		 * operation this emitter names a refusal for is one it declines to serve, out loud; an operation
		 * that simply vanishes is the defect. `mounted + refused === declared` distinguishes them, where
		 * `mounted === declared` could be satisfied by emitting an unreachable route, which is exactly
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
		 * **One `app.<verb>(` per distinct verb+path slot.** Anything more is a handler the router
		 * can never reach, because it matches in registration order.
		 *
		 * Counted from the SOURCE, because `app.routes` cannot answer it: Hono lists one entry per
		 * middleware as well as per handler, all sharing the slot, so a duplicate registration is
		 * indistinguishable from a validator once de-duplicated, and de-duplicating is what the slot
		 * count has to do. A control caught exactly that: disabling the grouping reintroduced the
		 * defect and a slot-only arm stayed green.
		 */
		const unreachable = measured
			.filter((entry) => entry.registrations !== entry.slots)
			.map(
				(entry) => `${entry.name}: ${entry.registrations} registrations onto ${entry.slots} slots`,
			);
		expect(unreachable.toSorted()).toEqual([]);
	});

	/**
	 * A registered path with the LEGAL greedy form erased, so what remains is only an unconverted
	 * template.
	 *
	 * **`:name{.+}` is valid Hono and contains a brace**, so an arm scanning for `{` rejects it. That
	 * form is how a path parameter declared with RFC 6570 reserved expansion is mounted, and it became
	 * legal the day this emitter started rendering it. Erasing it first is what keeps the arm about
	 * unconverted templates rather than about braces.
	 */
	function withoutGreedy(path: string): string {
		return path.replaceAll(/:[A-Za-z0-9_.~-]+\{\.\+\}/g, ":x");
	}

	it("tells the legal greedy form from an unconverted template", () => {
		// Its own control, because the arm below passes when it finds nothing and erasing too much is
		// exactly how it would find nothing.
		expect(withoutGreedy("/vault/:path{.+}")).not.toContain("{");
		expect(withoutGreedy("/vault/:path{.+}/move")).not.toContain("{");
		expect(withoutGreedy("/things/{thing-id}")).toContain("{");
		expect(withoutGreedy("/repo/:owner/:ref{.+}")).not.toContain("{");
	});

	it("mounts no route still carrying a path template", () => {
		/**
		 * **A route mounted at the literal `/things/{thing-id}` is reachable by nobody**, and every
		 * count reads it as present. This is the arm that would have caught it.
		 */
		const literal: string[] = [];
		for (const compiled of sources) {
			if (compiled.failure !== undefined) continue;
			const source = readFileSync(join(compiled.serverDir, "app.gen.ts"), "utf8");
			for (const match of source.matchAll(/^\t\t"([^"]*)",$/gm)) {
				if (withoutGreedy(match[1] ?? "").includes("{")) {
					literal.push(`${compiled.scenario.name}: ${match[1]}`);
				}
			}
		}
		expect(literal.toSorted()).toEqual([]);
	});

	it("raises no warning of its own", () => {
		/**
		 * A warning from this emitter means "the output is knowingly not what the document says, and we
		 * are shipping it anyway". There was one such warning for exactly one commit, marking an
		 * injected discriminator, and it was the wrong answer. A custom track with a label on it.
		 */
		const warnings = sources.flatMap((compiled) => compiled.emitterWarnings ?? []);
		expect(warnings.toSorted()).toEqual([]);
	});

	it("fails only where the library refuses, and never with a crash", () => {
		/**
		 * **`oracle` failures are not ours and must never be counted as ours.** `routes` is refused by
		 * `@typespec/openapi3` itself (OpenAPI cannot express a path containing a query string) and
		 * `special-words` crashes it. Folding those into one number is how a corpus starts lying: it
		 * would move when Microsoft fix their emitter and nobody would know whether we had regressed.
		 */
		const ours = sources
			.filter((compiled) => compiled.failure?.owner === "ours")
			.map((compiled) => `${compiled.scenario.name} :: ${compiled.failure?.code}`);
		/**
		 * **Refusals are asserted as a CLASS, not a list of scenario names.** What is a fact about
		 * this emitter: every refusal it raises is the one it declares, and no scenario is refused for
		 * an unnamed reason.
		 *
		 * This corpus now raises NONE. It used to raise `unroutable-verb` on twelve `@head` operations,
		 * which were refused because Hono rewrites HEAD to GET before matching. They are served now,
		 * registered under GET and told apart by `c.req.method`, so the only refusal this package
		 * declares is `unsupported-path-template` and no corpus scenario triggers it.
		 */
		const refusalCodes = [...new Set(sources.flatMap((compiled) => compiled.refusals ?? []))];
		expect(refusalCodes.toSorted()).toEqual([]);
		/**
		 * Every one of these is a REFUSAL raised by `typespec-http-zod`, reached through this emitter
		 * because it runs the library. This package adds exactly one refusal of its own,
		 * `unsupported-path-template`, and no corpus scenario triggers it.
		 */
		/**
		 * `type/property/value-types` used to be here under `unsupported-type`. It compiles against
		 * `typespec-http-zod@0.2.0`: a `never` property is dropped from the emitted schema exactly as
		 * `@typespec/openapi3` drops it from the document, rather than being refused. The scenario had
		 * never been graded at all while it failed to compile.
		 *
		 * Both survivors mirror a first-party rule. openapi3 raises its own error on the status-code
		 * range, and the discriminator one is upstream `microsoft/typespec#7141`.
		 */
		expect(ours.toSorted()).toEqual([
			"response/status-code-range :: typespec-http-zod/unsupported-status-code-range",
			"type/union/discriminated :: typespec-http-zod/undeclared-discriminator",
		]);
		expect(ours.filter((entry) => entry.includes("crashed"))).toEqual([]);
	});
});

/**
 * **What compares the emitted server to the emitted document.**
 *
 * Both defects that reached a consumer this week were the same shape: two artefacts generated by one
 * program, compared by nothing. The server and the contracts disagreed about a renamed parameter and
 * about a binary body, and each was found by a consumer rather than by either repository.
 *
 * `authz.test.ts` and `base-path.test.ts` both open by saying the gate the DOCUMENT publishes is the
 * gate the server applies, and that the server serves the URLs the document publishes. Neither read
 * the document. They read the emitted server and compared it to an expectation written by hand, which
 * is the same thing as agreeing with ourselves.
 *
 * This reads both artefacts, over every scenario in the corpus. The two are derived independently:
 * this emitter asks `@typespec/http` for the authentication and the servers, and `@typespec/openapi3`
 * walks the program itself. Nothing forces them to agree, so nothing except a comparison can show
 * that they do.
 */
describe("the emitted server agrees with the emitted document", () => {
	interface Divergence {
		readonly scenario: string;
		readonly what: string;
		readonly document: string;
		readonly server: string;
	}

	/**
	 * The `deps.authorize(...)` argument on the registration that serves an operation.
	 *
	 * Keyed on the operation id, not the path. Routes are grouped into a sub-app per resource, so the
	 * registration carries a path RELATIVE to its mount: the document says
	 * `/authentication/api-key/valid` and the registration says `/api-key/valid`. Matching on the path
	 * reported ten divergences on the first run, every one of them this function's fault rather than
	 * the emitter's. The generated call site names the operation, so that is the key with no
	 * arithmetic to get wrong.
	 */
	function gateFor(source: string, operationId: string): string | undefined {
		const call = source.indexOf(`handlersFor(c).${operationId}(`);
		if (call < 0) return undefined;
		// Walk back to the registration this call sits in, then read its gate.
		const start = source.lastIndexOf("\n\t\t.", call);
		return /deps\.authorize\((\[[\s\S]*?\])\)/.exec(source.slice(start, call))?.[1];
	}

	/** Scheme names only, so a mismatch names which artefact moved rather than dumping both. */
	function schemesOf(text: string): string[] {
		return [...text.matchAll(/"([A-Za-z0-9_]+)"\s*:/g)].map((m) => m[1] ?? "").toSorted();
	}

	it("gates exactly the operations the document secures, with the same schemes", () => {
		const divergences: Divergence[] = [];
		/**
		 * **Counted, because an arm that collects divergences passes by finding none, and finding none
		 * is exactly what happens when it reads nothing at all.**
		 *
		 * Measured: making the document lookup match no file left this arm green over ZERO comparisons.
		 * That is not hypothetical. `@typespec/openapi3` writes `<outDir>/openapi.json` for one version
		 * and `<outDir>/<version>/openapi.json` for more than one, so the day this corpus grades a second
		 * OpenAPI version, a flat scan finds nothing and every scenario is skipped by the line below.
		 * The arm would report success having compared no operation in any scenario.
		 */
		let compared = 0;
		let documentsRead = 0;
		for (const compiled of sources) {
			if (compiled.failure !== undefined) continue;
			const documents = readdirSync(compiled.openapiDir).filter((n) => n.endsWith(".json"));
			const chosen = documents.toSorted().at(-1);
			if (chosen === undefined) continue;
			documentsRead += 1;
			const document = JSON.parse(
				readFileSync(join(compiled.openapiDir, chosen), "utf8"),
			) as OpenApiDocument;
			const source = readFileSync(join(compiled.serverDir, "app.gen.ts"), "utf8");

			for (const [path, item] of Object.entries(document.paths ?? {})) {
				for (const [verb, operation] of Object.entries(item)) {
					if (verb === "parameters") continue;
					const declared = operation.security ?? document.security ?? [];
					// `[{}]` is how openapi3 spells "no authentication", and no gate is emitted for it.
					const secured = declared.filter((one) => Object.keys(one).length > 0);
					const operationId = operation.operationId;
					if (operationId === undefined) continue;
					const gate = gateFor(source, operationId);
					compared += 1;
					const expected = secured.flatMap((one) => Object.keys(one)).toSorted();
					const actual = gate === undefined ? [] : schemesOf(gate);
					if (JSON.stringify(expected) !== JSON.stringify(actual)) {
						divergences.push({
							scenario: compiled.scenario.name,
							what: `${verb.toUpperCase()} ${path}`,
							document: JSON.stringify(expected),
							server: JSON.stringify(actual),
						});
					}
				}
			}
		}
		expect(
			divergences.map((d) => `${d.scenario} ${d.what}: document ${d.document}, server ${d.server}`),
		).toEqual([]);
		// Floors on BOTH sides of the read: a document found but no operation compared is the same
		// vacuum as no document at all, and only one of the two is visible from the other's count.
		expect(
			documentsRead,
			"no scenario yielded a document to compare against",
		).toBeGreaterThanOrEqual(40);
		expect(compared, "no operation had its gate compared").toBeGreaterThanOrEqual(300);
	});
});

/**
 * **The status arms and request media types the server carries are the document's.**
 *
 * `deps.respond` receives the arms and chooses one, and `zValidator`'s target is chosen from the
 * request media types. Both are read from the library's IR, and the document is walked separately by
 * `@typespec/openapi3`. Nothing forced them to agree and nothing compared them.
 */
describe("the server carries the statuses and media types the document declares", () => {
	function armsFor(schemas: string, name: string): string[] {
		const declaration = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]) satisfies`).exec(schemas);
		return [...(declaration?.[1] ?? "").matchAll(/status:\s*("?[\w"]+"?)/g)]
			.map((m) => (m[1] ?? "").replaceAll('"', ""))
			.toSorted();
	}

	/**
	 * Non-vacuity for the arm below, and it needs its own because the usual control cannot work here.
	 *
	 * Both sides of this pair are produced by dependencies: `schemas.gen.ts` by `typespec-http-zod`
	 * and the document by `@typespec/openapi3`. Breaking this emitter cannot move either, and
	 * corrupting the emitted file on disk is undone by the `beforeAll` that regenerates it. So the
	 * comparison itself is exercised, with inputs known to differ and known to match.
	 */
	it("detects a status arm that disagrees", () => {
		const matching = "const xResponses = [{ status: 200, schema: a }] satisfies";
		const differing = "const xResponses = [{ status: 599, schema: a }] satisfies";
		expect(armsFor(matching, "xResponses")).toEqual(["200"]);
		expect(armsFor(differing, "xResponses")).toEqual(["599"]);
		expect(armsFor(matching, "xResponses")).not.toEqual(armsFor(differing, "xResponses"));
		// And a name it cannot find yields nothing, which is what makes the arm skip rather than lie.
		expect(armsFor(matching, "missingResponses")).toEqual([]);
	});

	it("declares the same status arms per operation as the document", () => {
		const divergences: string[] = [];
		let compared = 0;
		for (const compiled of sources) {
			if (compiled.failure !== undefined) continue;
			const documents = readdirSync(compiled.openapiDir).filter((n) => n.endsWith(".json"));
			const chosen = documents.toSorted().at(-1);
			if (chosen === undefined) continue;
			const document = JSON.parse(
				readFileSync(join(compiled.openapiDir, chosen), "utf8"),
			) as OpenApiDocument;
			const schemas = readFileSync(join(compiled.serverDir, "schemas.gen.ts"), "utf8");

			for (const item of Object.values(document.paths ?? {})) {
				for (const [verb, operation] of Object.entries(item)) {
					if (verb === "parameters") continue;
					const id = operation.operationId;
					if (id === undefined) continue;
					const declared = Object.keys(operation.responses ?? {}).toSorted();
					if (declared.length === 0) continue;
					const carried = armsFor(schemas, `${id}Responses`);
					if (carried.length === 0) continue;
					compared += 1;
					if (JSON.stringify(declared) !== JSON.stringify(carried)) {
						divergences.push(
							`${compiled.scenario.name} ${id}: document ${JSON.stringify(declared)}, server ${JSON.stringify(carried)}`,
						);
					}
				}
			}
		}
		expect(divergences.toSorted().slice(0, 20)).toEqual([]);
		// Non-vacuity: an arm reader that matched nothing would compare nothing and pass.
		expect(compared, "no operation had its arms compared").toBeGreaterThanOrEqual(200);
	});
});
