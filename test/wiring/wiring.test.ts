import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture } from "../support/compile-fixture.js";

/**
 * **Question 3: can an application be built on both packages, and does it answer real requests?**
 *
 * ⚠️ **This is the only oracle that can see a validator-to-WIRE defect, and that blind spot has no
 * floor to warn you.** For a flattened collection parameter the document said `array`, the validator
 * said `array`, they agreed perfectly, and the server rejected every conformant caller — because the
 * disagreement was with what arrives, and both sides were describing what was declared. Anything
 * about SERIALISATION is reachable only by making a request.
 *
 * Two halves, and both are needed:
 *
 * 1. **it compiles** — `consumer.fixture.ts` is a typed application, and the generated signatures
 *    have to be satisfiable without a cast. A signature no application could satisfy passed every
 *    other test for most of this emitter's life, because the suite that mounted it cast to `unknown`;
 * 2. **it answers** — real requests through the real router, against the real validators.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const referenceDir = join(here, "..", "reference");

beforeAll(async () => {
	/**
	 * ⚠️ **Compiled with `runtime-module` pointed at a module that substitutes REAL types.** Left at
	 * the default, `Result<T>` is `T` and `Ctx` is `unknown`, so the generated interface degrades to
	 * something almost any function satisfies and the compile below proves nothing.
	 */
	await compileFixture(referenceDir, "service", {
		runtimeModule: "../../../wiring/runtime.fixture.js",
		outName: "service-wired",
	});
}, 300_000);

describe("an application compiles against the generated server", () => {
	it("satisfies every generated signature, with no cast anywhere", () => {
		const config = join(here, "tsconfig.wiring.json");
		writeFileSync(
			config,
			JSON.stringify({
				compilerOptions: {
					target: "es2023",
					module: "nodenext",
					moduleResolution: "nodenext",
					strict: true,
					exactOptionalPropertyTypes: true,
					noUncheckedIndexedAccess: true,
					noEmit: true,
					skipLibCheck: true,
					types: [],
				},
				include: ["./consumer.fixture.ts", "./runtime.fixture.ts", "./rpc.fixture.ts"],
			}),
		);
		let output = "";
		try {
			execFileSync(
				join(here, "..", "..", "node_modules", ".bin", "tsc"),
				["-p", config, "--ignoreConfig"],
				{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			);
		} catch (error) {
			const asExec = error as { stdout?: string; stderr?: string };
			output = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`;
		}
		expect(output.trim(), output).toBe("");
	});

	it("contains no cast, so a failure cannot be papered over", () => {
		// A `as unknown as` anywhere in the consumer would hide exactly what this suite exists to find.
		const source = execFileSync("cat", [join(here, "consumer.fixture.ts")], { encoding: "utf8" });
		expect(source).not.toMatch(/as unknown as/);
		expect(source).not.toMatch(/@ts-(expect-error|ignore)/);
	});
});

describe("the application answers real requests", () => {
	async function app(): Promise<{
		request: (input: string, init?: RequestInit) => Promise<Response>;
	}> {
		const { buildApp } = (await import("./consumer.fixture.js")) as {
			buildApp: () => { request: (input: string, init?: RequestInit) => Promise<Response> };
		};
		return buildApp();
	}

	it("serves a route whose path parameter carries a hyphen", async () => {
		const response = await (
			await app()
		).request("/widgets/w-1?%24select=name", {
			headers: { "x-request-id": "r-1" },
		});
		// ⚠️ A literal `{widget-id}` route answers 404 here while every count reads it as mounted.
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ id: "w-1" });
	});

	it("refuses a request missing a required header, naming it a 400", async () => {
		const response = await (await app()).request("/widgets/w-1");
		// The header validator keys on the WIRE name; keyed on the property name it would 400 every
		// conformant caller instead, which is the same status for the opposite reason.
		expect(response.status).toBe(400);
	});

	it("accepts a list flattened into one query value", async () => {
		/**
		 * ⚠️ **The defect no document comparison could see.** `?tags=a,b,c` is ONE string on the wire;
		 * a validator expecting an array refuses it, while the document and the validator both say
		 * `array` and agree perfectly.
		 */
		const response = await (await app()).request("/widgets?tags=a,b,c");
		expect(response.status).toBe(200);
	});

	it("accepts the same parameter omitted entirely", async () => {
		// Optionality sits outside the preprocess wrapper; inside it, an omitted parameter 400s.
		const response = await (await app()).request("/widgets");
		expect(response.status).toBe(200);
	});

	it("answers a bodyless success with 204 and no body", async () => {
		const response = await (await app()).request("/widgets/w-1", { method: "DELETE" });
		expect(response.status).toBe(204);
		expect(await response.text()).toBe("");
	});

	it("answers HEAD from the GET route, with the body stripped", async () => {
		/**
		 * ⚠️ **This is Hono's behaviour, not the emitter's, and the emitter used to fight it.**
		 * `hono-base.js` rewrites every HEAD request to GET before matching, so a HEAD request runs the
		 * GET route — its validators included. That is what RFC 9110 requires of HEAD, and it is why a
		 * separately-registered HEAD route can never be reached.
		 *
		 * The header is supplied because the GET route requires it: HEAD behaving *identically* to GET
		 * is the point, and a HEAD request that skipped validation would be the anomaly.
		 */
		const response = await (
			await app()
		).request("/widgets/w-1", {
			method: "HEAD",
			headers: { "x-request-id": "r-1" },
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});

	it("404s a HEAD request on a path with no GET, rather than pretending to serve it", async () => {
		// `/trees` is POST-only. Hono rewrites HEAD to GET, finds nothing, and 404s — which is exactly
		// why a `@head` operation on such a path is refused rather than emitted.
		const response = await (await app()).request("/trees", { method: "HEAD" });
		expect(response.status).toBe(404);
	});

	it("negotiates on Accept rather than validating it", async () => {
		const json = await (
			await app()
		).request("/report", {
			headers: { accept: "application/json" },
		});
		expect(json.status).toBe(200);
		expect(json.headers.get("content-type")).toMatch(/application\/json/);

		const text = await (await app()).request("/report", { headers: { accept: "text/plain" } });
		expect(text.status).toBe(200);
		expect(await text.text()).toBe("plain text");
	});

	it("answers 406 for an unacceptable Accept, never 400", async () => {
		/**
		 * ⚠️ **`accept` SELECTS the operation.** Validating it against one member's literal answers 400
		 * to a well-formed request whose real answer is 406 — and RFC 9110 is explicit that a `q=0` is a
		 * refusal rather than a weak preference.
		 */
		const response = await (await app()).request("/report", { headers: { accept: "image/png" } });
		expect(response.status).toBe(406);
	});

	it("serves an unauthenticated operation without a caller", async () => {
		const response = await (await app()).request("/health");
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ status: "ok" });
	});

	it("validates a polymorphic body against the variant its discriminator names", async () => {
		const good = await (
			await app()
		).request("/shapes", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ kind: "circle", label: "c", radius: 1 }),
		});
		expect(good.status).toBe(200);

		// A body carrying the base's properties but no valid variant must be refused.
		const bad = await (
			await app()
		).request("/shapes", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ kind: "hexagon", label: "h" }),
		});
		expect(bad.status).toBe(400);
	});

	it("refuses a body that breaks a constraint the document publishes", async () => {
		const response = await (
			await app()
		).request("/widgets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			// `name` is `@minLength(1)`, and `weight` is `@minValue(0)`.
			body: JSON.stringify({ id: "w", name: "", weight: -1, colour: "red", tags: [] }),
		});
		expect(response.status).toBe(400);
	});

	it("refuses an undeclared property on a closed model", async () => {
		const response = await (
			await app()
		).request("/widgets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "w",
				name: "n",
				weight: 1,
				colour: "red",
				tags: [],
				surplus: true,
			}),
		});
		// `seal-object-schemas` is on, and the document says `unevaluatedProperties: {not: {}}`.
		expect(response.status).toBe(400);
	});
});
