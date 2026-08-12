import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

/**
 * **Idiomatic Hono, written by hand, deliberately without reference to what this emitter produces.**
 *
 * The conformance and round-trip suites both compare our output against `@typespec/openapi3` — they
 * prove the *document* and the *validator* agree. Neither says anything about whether the server we
 * emit looks and behaves like a server somebody would write. That is what this is for.
 *
 * ⚠️ **The value is entirely in its independence.** This follows the pattern in Hono's own
 * validation guide — `app.post(path, zValidator(target, schema), (c) => c.req.valid(target))` — with
 * `@hono/zod-validator`, the Hono organisation's own middleware. Written against our emitter's
 * output instead, it would encode our assumptions and agree with us by construction.
 *
 * ⚠️ **Plain `Hono`, NOT `OpenAPIHono`.** An earlier version of this file used `@hono/zod-openapi`,
 * which is the same validation plus a document GENERATED FROM THE CODE. That is spec-last, the
 * opposite direction to this pipeline, and shipping it would put a second document generator in the
 * runtime whose output could disagree with the contract `@typespec/openapi3` publishes from the
 * spec. We want its validation, not its documentation, so the dependency is `@hono/zod-validator`:
 * the same middleware doing the same work, without the half that competes.
 *
 * Source: <https://hono.dev/docs/guides/validation>, retrieved 2026-08-11.
 */

/**
 * Only REQUEST schemas appear here, because that is all `zValidator` validates. Hono's guide does
 * not validate responses, and inventing a response validator for the reference would measure our
 * idea of Hono rather than Hono's.
 */
const CreateWidgetSchema = z.object({
	name: z.string().min(1),
	weight: z.number().int(),
});

const ParamsSchema = z.object({ id: z.string().min(1) });

/** The one widget every read answers with, so both apps can be compared on the same data. */
export const THE_WIDGET = { id: "w-1", name: "Sprocket", weight: 42 } as const;

/**
 * `zValidator`'s third argument. Without it a failure is Hono's own 400 with a different body; with
 * it, a rejected request is observable as exactly the status and shape this API promises.
 */
const invalid = (
	result: { success: boolean },
	c: { json: (body: unknown, status: 400) => Response },
) => (result.success ? undefined : c.json({ error: "invalid" }, 400));

export function createReferenceApp(): Hono {
	const app = new Hono();

	app.get("/widgets/:id", zValidator("param", ParamsSchema, invalid), (c) =>
		c.json({ ...THE_WIDGET, id: c.req.valid("param").id }, 200),
	);

	app.get("/widgets", (c) => c.json([THE_WIDGET], 200));

	app.post("/widgets", zValidator("json", CreateWidgetSchema, invalid), (c) => {
		const body = c.req.valid("json");
		return c.json({ id: THE_WIDGET.id, name: body.name, weight: body.weight }, 201);
	});

	/** A bodyless success — the case that used to vanish from the route table entirely. */
	app.delete("/widgets/:id", zValidator("param", ParamsSchema, invalid), (c) => c.body(null, 204));

	return app;
}
