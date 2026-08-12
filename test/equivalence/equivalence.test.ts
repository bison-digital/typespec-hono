import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";
import { Hono as HonoApp } from "hono";
import { createReferenceApp, THE_WIDGET } from "./reference-app.js";

/**
 * **Does the Hono we emit behave like Hono somebody would write?**
 *
 * Two apps serve the same API. One is hand-written in the idiom Hono's own validation guide
 * publishes — `app.get(path, zValidator(target, schema), handler)`. The other is **the server this
 * emitter generates** from `api.tsp`. The same requests go to both, and the answers have to match.
 *
 * ⚠️ **This used to compare the wrong thing.** The emitter produced a data table and a forty-line
 * hand-written registrar interpreted it at run time, so the comparison was "gold standard versus my
 * test scaffolding, fed by our data" — the emitter's output was never the artefact under test. The
 * registrar is gone; `registerRoutes` from `app.gen.ts` mounts the app directly.
 *
 * ⚠️ **Behaviour AND shape.** Requests measure what a caller can observe, which no structural check
 * can; the routing table comparison below measures that both apps mount the same verbs and paths,
 * which behaviour alone would miss if both happened to 404. Neither replaces the other.
 *
 * ⚠️ **The reference must stay independent.** `reference-app.ts` is written from Hono's published
 * idiom, never from this emitter's output. The moment it is adjusted to match what we emit, the
 * suite proves that we agree with ourselves.
 *
 * What this catches that nothing else does: the conformance differential compares our validator to
 * the document, and the round-trip compares documents to documents. Neither notices a route mounted
 * on the wrong verb, a `204` that answers with a body, or a validation failure that arrives as a
 * `500`. Those are only visible from outside, through the door a caller uses.
 */

const here = fileURLToPath(new URL(".", import.meta.url));

/** Both apps answer from the same data, so a difference is never about the handler. */
const OPERATIONS = {
	getWidget: (_ctx: unknown, input: { id: string }) => ({ ...THE_WIDGET, id: input.id }),
	createWidget: (_ctx: unknown, input: { name: string; weight: number }) => ({
		id: THE_WIDGET.id,
		name: input.name,
		weight: input.weight,
	}),
	listWidgets: () => [THE_WIDGET],
	deleteWidget: () => undefined,
};

/**
 * What the app supplies to the generated server. This fixture has no auth and no result envelope,
 * so `context` hands back a token nobody reads and `respond` answers the arm's status directly.
 */
const DEPS = {
	context: () => ({}),
	noContext: (c: { text: (body: string, status: 401) => Response }) => c.text("no context", 401),
	invalid: (result: { success: boolean }, c: { json: (body: unknown, status: 400) => Response }) =>
		result.success ? undefined : c.json({ error: "invalid" }, 400),
	respond: (
		c: {
			json: (body: unknown, status: number) => Response;
			body: (b: null, s: number) => Response;
		},
		arms: readonly { status: number; schema?: unknown }[],
		result: unknown,
	) => {
		const arm = arms.at(-1) ?? { status: 200, schema: undefined };
		if (arm.schema === undefined) return c.body(null, arm.status);
		return c.json(result, arm.status);
	},
};

interface Exchange {
	readonly what: string;
	readonly path: string;
	readonly init?: RequestInit;
}

/**
 * The matrix. Every row is a question a caller can ask, including the ones that should be refused.
 *
 * The refusals matter more than the successes: an emitter that mounts a route but validates nothing
 * passes every happy path and fails every one of these.
 */
const EXCHANGES: readonly Exchange[] = [
	{ what: "a read by id", path: "/widgets/w-1" },
	{ what: "a list", path: "/widgets" },
	{
		what: "a delete, which answers 204 with no body",
		path: "/widgets/w-1",
		init: { method: "DELETE" },
	},
	{
		what: "a valid create",
		path: "/widgets",
		init: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Cog", weight: 7 }),
		},
	},
	{
		what: "a create whose name breaks minLength",
		path: "/widgets",
		init: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "", weight: 7 }),
		},
	},
	{
		what: "a create missing a required property",
		path: "/widgets",
		init: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Cog" }),
		},
	},
	{
		what: "a create whose weight is the wrong type",
		path: "/widgets",
		init: {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Cog", weight: "heavy" }),
		},
	},
	{ what: "a path that does not exist", path: "/nope" },
	{ what: "a verb the path does not serve", path: "/widgets/w-1", init: { method: "PATCH" } },
];

interface Answer {
	readonly status: number;
	readonly body: string;
}

async function ask(app: Hono, exchange: Exchange): Promise<Answer> {
	const response = await app.request(exchange.path, exchange.init);
	return { status: response.status, body: await response.text() };
}

let reference: Hono;
let generated: Hono;
let mountedOperations: number;

beforeAll(async () => {
	reference = createReferenceApp() as unknown as Hono;
	const compiled = await compileFixture(here, "api");
	if (compiled.diagnostics.length > 0) {
		throw new Error(
			`the reference spec did not compile cleanly: ${compiled.diagnostics
				.map((d) => `${d.severity}: ${d.code}`)
				.join(", ")}`,
		);
	}
	// The emitted server itself — not a table plus scaffolding.
	const { registerRoutes } = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	const app = new HonoApp();
	// A factory, because in Workers the backend hangs off `c.env` and exists only per request. This
	// fixture has nothing to resolve, which is exactly the case that must stay a one-line arrow.
	registerRoutes(app, () => OPERATIONS, DEPS);
	generated = app;
	// Distinct verb+path: Hono lists each `zValidator` as a routes entry too, so a raw length counts
	// middleware as operations and would have read 7 for a four-operation API.
	mountedOperations = new Set(
		app.routes.filter((r) => r.method !== "ALL").map((r) => `${r.method} ${r.path}`),
	).size;
}, 600_000);

/** Every verb+path an app serves, which is the shape a caller sees before any body is exchanged. */
const routingTableOf = (app: Hono): string[] =>
	[
		...new Set(
			app.routes
				.filter((route) => route.method !== "ALL")
				.map((route) => `${route.method} ${route.path}`),
		),
	].toSorted();

describe("the emitted app is shaped like the hand-written one", () => {
	/**
	 * ⚠️ **The comparison the old design could not make.** While the emitter produced a table and a
	 * hand-written registrar mounted it, there was no artefact to compare — only behaviour, through
	 * scaffolding written for this test. Now both sides are Hono apps built the same way, so "they
	 * should be the same" is an assertion.
	 *
	 * Verbs and paths rather than source text: a diff of generated against handwritten measures
	 * formatting, fails on a renamed local, and passes on a wrong status code. What must match is
	 * what a caller can reach.
	 */
	it("mounts exactly the same verbs and paths", () => {
		expect(routingTableOf(generated)).toEqual(routingTableOf(reference));
	});

	it("mounts something, so the comparison above is not two empty lists", () => {
		expect(routingTableOf(reference).length).toBe(4);
	});
});

describe("the emitted app answers like the hand-written one", () => {
	it("mounted the operations the spec declares", () => {
		// Without this every arm below could pass by both apps 404ing identically.
		expect(mountedOperations).toBe(4);
	});

	for (const exchange of EXCHANGES) {
		it(`answers ${exchange.what} the same way`, async () => {
			const [expected, actual] = await Promise.all([
				ask(reference, exchange),
				ask(generated, exchange),
			]);
			expect({ what: exchange.what, ...actual }).toEqual({ what: exchange.what, ...expected });
		});
	}

	it("refuses as often as it accepts, so the matrix is not all happy paths", async () => {
		const answers = await Promise.all(EXCHANGES.map((exchange) => ask(reference, exchange)));
		const refused = answers.filter((answer) => answer.status >= 400).length;
		const accepted = answers.filter((answer) => answer.status < 400).length;
		expect(refused).toBeGreaterThanOrEqual(3);
		expect(accepted).toBeGreaterThanOrEqual(3);
	});
});
