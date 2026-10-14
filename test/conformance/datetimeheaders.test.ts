import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost } from "@typespec/compiler";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * **A date-time header reaches its handler, and leaves it, in the form the corpus sends.**
 *
 * TypeSpec's wire form for a `utcDateTime` header with no `@encode` is an RFC 7231 HTTP-date, and
 * `@typespec/openapi3` publishes it as `format: http-date`. The validators this server runs checked
 * it as RFC 3339 until typespec-http-zod `0.29.0` (its issue #4), so the mock's own requests were
 * refused with 400 and a handler setting the header as an HTTP-date answered 500 through its own
 * response contract. Three `@typespec/http-specs` scenarios failed that way.
 *
 * **The requests and the values are the mock's**, from `encode/datetime` and
 * `special-headers/repeatability`, sent through the generated routes unchanged.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const specs = fileURLToPath(
	new URL("../../node_modules/@typespec/http-specs/specs/", import.meta.url),
);

const HTTP_DATE = "Fri, 26 Aug 2022 14:38:00 GMT";

interface Served {
	readonly status: number;
	readonly reached: boolean;
	readonly input: Record<string, unknown> | undefined;
	readonly refusal: string | undefined;
	readonly response: Response;
}

/** Serve one scenario, every handler answering 204 with `headers` and recording what it was given. */
async function serve(
	scenario: string,
	headers: Record<string, unknown>,
): Promise<(method: string, uri: string, sent: Record<string, string>) => Promise<Served>> {
	const outDir = join(here, ".out-datetimeheaders", scenario.replaceAll("/", "__"));
	rmSync(outDir, { recursive: true, force: true });
	const program = await compile(NodeHost, join(specs, scenario, "main.tsp"), {
		outputDir: outDir,
		emit: ["typespec-hono"],
		options: {
			"typespec-hono": {
				"emitter-output-dir": outDir,
				"contracts-output-dir": outDir,
				"contracts-package": "./vocabularies.gen.js",
				"seal-object-schemas": true,
			},
		},
	});
	expect(program.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
	const server = (await import(join(outDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => void;
	};
	let reached = false;
	let input: Record<string, unknown> | undefined;
	let refusal: string | undefined;
	const app = new Hono();
	type Context = { json: (body: unknown, status: number) => Response };
	server.registerRoutes(
		app,
		() =>
			new Proxy(
				{},
				{
					get: () => (_ctx: unknown, received: Record<string, unknown>) => {
						reached = true;
						input = received;
						return { status: 204, headers };
					},
				},
			),
		{
			authorize: () => async (_c: Context, next: () => Promise<void>) => {
				await next();
				return undefined;
			},
			context: () => ({}),
			noContext: (c: Context) => c.json({}, 401),
			notAcceptable: (c: Context) => c.json({}, 406),
			invalid: (result: { success: boolean; error?: unknown }, c: Context) => {
				if (result.success) return undefined;
				refusal = String(result.error).slice(0, 300);
				return c.json({}, 400);
			},
		},
	);
	return async (method, uri, sent) => {
		reached = false;
		input = undefined;
		refusal = undefined;
		const response = await app.request(uri, { method, headers: sent });
		return { status: response.status, reached, input, refusal, response };
	};
}

describe("http-specs encode/datetime: a date-time header in the form the mock sends", () => {
	let send: Awaited<ReturnType<typeof serve>>;

	beforeAll(async () => {
		send = await serve("encode/datetime", { value: HTTP_DATE });
	}, 300_000);

	it("Encode_Datetime_Header_default: an HTTP-date reaches the handler as sent", async () => {
		const served = await send("GET", "/encode/datetime/header/default", { value: HTTP_DATE });
		expect(served.refusal).toBeUndefined();
		expect(served.status).toBe(204);
		expect(served.input).toEqual({ value: HTTP_DATE });
	});

	it("Encode_Datetime_Header_rfc3339: the explicit encoding still takes RFC 3339", async () => {
		const value = "2022-08-26T18:38:00.000Z";
		const served = await send("GET", "/encode/datetime/header/rfc3339", { value });
		expect(served.status).toBe(204);
		expect(served.input).toEqual({ value });
		// And checks it: an HTTP-date is not RFC 3339.
		expect(
			(await send("GET", "/encode/datetime/header/rfc3339", { value: HTTP_DATE })).status,
		).toBe(400);
	});

	it("Encode_Datetime_ResponseHeader_default: a handler's HTTP-date leaves as set", async () => {
		const served = await send("GET", "/encode/datetime/responseheader/default", {});
		expect(served.status).toBe(204);
		expect(served.response.headers.get("value")).toBe(HTTP_DATE);
	});
});

describe("http-specs special-headers/repeatability: Repeatability-First-Sent", () => {
	it("SpecialHeaders_Repeatability_immediateSuccess reaches the handler", async () => {
		const send = await serve("special-headers/repeatability", {
			"Repeatability-Result": "accepted",
		});
		const served = await send("POST", "/special-headers/repeatability/immediateSuccess", {
			"Repeatability-First-Sent": "Tue, 15 Nov 2022 12:45:26 GMT",
			"Repeatability-Request-ID": "2378d9bc-1726-11ee-be56-0242ac120002",
		});
		expect(served.refusal).toBeUndefined();
		expect(served.status).toBe(204);
		expect(served.response.headers.get("repeatability-result")).toBe("accepted");
	}, 300_000);
});
