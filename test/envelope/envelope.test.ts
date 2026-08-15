import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **The response envelope, at the boundary a handler is written against.**
 *
 * `@statusCode` and `@header` are stripped from the body schema - correctly, they are not body - so
 * a return type derived from that schema alone could not carry them. The emitted arms named them
 * anyway: `when: { property: "statusCode" }` tells `respond` which arm the handler meant, and
 * `headers: [{ property: "correlationId" }]` tells it where to read a header value from. Measured
 * before this existed, on `payload__head`: `Awaitable<Result<void>>` against an arm naming two
 * header properties - a contract published and unsatisfiable.
 *
 * **Requests, not emitted text.** Asserting that the signature mentions `statusCode` would pass for
 * a server that still answers 200 to everything.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let app: Hono;

beforeAll(async () => {
	const compiled = await compileFixture(here, "envelope", { outName: "envelope" });
	const server = (await import(join(compiled.outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	app = new Hono();
	const handlers = {
		// The whole point: the handler NAMES the status it means, and sets a header property.
		create: (_ctx: unknown, input: { id: string; label: string }) => ({
			// A body model is merged into the input, so the properties arrive at the top level.
			statusCode: input.id === "" ? 201 : 200,
			id: input.id,
			label: input.label,
		}),
		tagged: () => ({ id: "1", label: "one", correlationId: "abc-123" }),
		plain: () => ({ id: "1", label: "one" }),
	};
	server.registerRoutes(app, () => handlers, {
		authorize: () => async (_c: unknown, next: () => Promise<void>) => {
			await next();
		},
		context: () => ({}),
		noContext: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 401),
		notAcceptable: (c: { json: (b: unknown, s: number) => Response }) => c.json({}, 406),
		invalid: (
			result: { success: boolean },
			c: { json: (b: unknown, s: number) => Response },
		): Response | undefined => (result.success ? undefined : c.json(result, 400)),
		/**
		 * An app's own `respond`, written the way the arms ask to be read: the arm whose `when`
		 * matches the returned value wins, otherwise the one without a `when`. This is the contract
		 * the emitter publishes, so implementing it here is what proves the contract is usable.
		 */
		respond: (
			c: {
				json: (b: unknown, s: number, h?: Record<string, string>) => Response;
			},
			arms: readonly {
				status: number;
				headers?: readonly { name: string; property: string }[];
				when?: { property: string; value: unknown };
			}[],
			value: Record<string, unknown>,
		) => {
			const arm =
				arms.find(
					(candidate) =>
						candidate.when !== undefined && value[candidate.when.property] === candidate.when.value,
				) ?? arms.find((candidate) => candidate.when === undefined);
			const headers: Record<string, string> = {};
			for (const header of arm?.headers ?? []) {
				const carried = value[header.property];
				if (typeof carried === "string") headers[header.name] = carried;
			}
			return c.json(value, arm?.status ?? 200, headers);
		},
	});
}, 600_000);

describe("a handler can say which success status it means", () => {
	it("answers 201 when the handler asks for 201", async () => {
		const response = await app.request("/items", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "", label: "new" }),
		});
		expect(response.status).toBe(201);
	});

	it("answers 200 when it asks for 200, so the selector is doing the work", async () => {
		const response = await app.request("/items", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "7", label: "existing" }),
		});
		expect(response.status).toBe(200);
	});
});

describe("a declared response header reaches the response", () => {
	it("sets the header from the property its arm names", async () => {
		const response = await app.request("/items/1");
		expect(response.status).toBe(200);
		expect(response.headers.get("x-correlation-id")).toBe("abc-123");
	});
});
