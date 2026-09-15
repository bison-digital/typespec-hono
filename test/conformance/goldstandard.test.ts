import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import {
	compileScenario,
	depthSources,
	discoverScenarios,
	packageRoot,
	type CompiledScenario,
} from "./corpus.js";

/**
 * **The responses `hc` sees are the ones `@hono/zod-openapi` would REQUIRE, for every corpus route.**
 *
 * `@hono/zod-openapi` is how the Hono ecosystem types a route from a declared response set:
 * `RouteConfigToTypedResponse` turns `createRoute({ responses })` into the union of typed responses a
 * handler must return, one per declared status and body. Built here from the PUBLISHED DOCUMENT - its
 * statuses, its media types - with the library's schema for each body, it is an expectation this
 * package did not write. The other side is what `hc` infers from the generated `registerRoutes`, which
 * is everything the generated route actually serves.
 *
 * So the claim graded is the design's own: a generated route serves each declared response through a
 * typed Hono call, and a client sees exactly the document's responses, each with its own body.
 *
 * **Normalised, with each deviation named, because the two are not identical by design:**
 *
 * 1. **An exact status is not also a member of its range.** `RouteConfigToTypedResponse` maps `4XX`
 *    to all of `ClientErrorStatusCode`, so a declared `404` beside it appears twice, once with each
 *    body. OpenAPI resolves the exact code first, and so does `armFor`; the generated union is
 *    disjoint so that a body is checked against one response, not either.
 * 2. **`default` excludes 1xx and `-1`.** `new Response` throws outside 200-599, and Hono's
 *    `UnofficialStatusCode` is `-1`.
 * 3. **A contentless status carries no JSON body.** `c.json` refuses 101, 204, 205 and 304.
 * 4. **A body that is not JSON is compared as "not JSON".** `hc` reads such a response as opaque,
 *    and `RouteConfigToTypedResponse` types it as a bare `Response`, so its status is what there is to
 *    compare. The count of operations carrying one is recorded.
 *
 * **The BODY types come from Hono, not from `@hono/zod-openapi`, and that was measured.** Its
 * declaration file contains `import z = zodModule.z;` with `zodModule` declared nowhere, so under
 * TypeScript 7 `z` is `any` and every body it types is `any`: `TypedResponse<any, 403, "json">`. The
 * status machinery does not reach `z` and is unaffected, so the statuses each key answers - a range's
 * expansion, `default`'s exclusions - are read from it, and each JSON body is Hono's
 * `JSONParsed<z.infer<schema>>`, which is what `c.json` produces for that schema.
 *
 * **Skipped, and counted:** a route several operations share (content negotiation), whose document
 * entry merges bodies that belong to different handlers, and HEAD, which shares GET's route.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const outRoot = join(here, ".out-goldstandard");

interface DocumentResponse {
	readonly content?: Readonly<Record<string, unknown>>;
}

interface DocumentOperation {
	readonly operationId?: string;
	readonly responses?: Readonly<Record<string, DocumentResponse>>;
}

let compiled: readonly CompiledScenario[] = [];

beforeAll(async () => {
	const collected: CompiledScenario[] = [];
	for (const scenario of [...discoverScenarios(), ...depthSources()]) {
		collected.push(await compileScenario(scenario, outRoot));
	}
	compiled = collected;
}, 900_000);

const isJson = (type: string): boolean => /^application\/(json|.*\+json)$/.test(type);
const isText = (type: string): boolean => type.startsWith("text/plain");

/** `[status, schema identifier]` per arm, read from the library's emitted arm list. */
function armsOf(schemas: string, operationId: string): ReadonlyMap<string, string | undefined> {
	const line = new RegExp(`^export const ${operationId}Responses = (.*)$`, "m").exec(schemas)?.[1];
	if (line === undefined) return new Map();
	return new Map(
		[...line.matchAll(/\{ status: "?([\w]+)"?, schema: (\w+)/g)].map((match) => [
			match[1] ?? "",
			match[2] === "undefined" ? undefined : match[2],
		]),
	);
}

/** A response key as a `RouteConfig` key: a number literal, a range string, or `default`. */
const keyOf = (status: string): string => (/^\d+$/.test(status) ? status : JSON.stringify(status));

interface Plan {
	readonly source: string;
	readonly compared: number;
	readonly skipped: number;
	readonly opaqueMedia: number;
}

/** The oracle file for one scenario, or `undefined` where it has nothing to compare. */
async function planFor(scenario: CompiledScenario): Promise<Plan | undefined> {
	if (scenario.failure !== undefined) return undefined;
	if (!existsSync(join(scenario.serverDir, "app.gen.ts"))) return undefined;
	const documents = readdirSync(scenario.openapiDir).filter((name) => name.endsWith(".json"));
	const chosen =
		scenario.latestVersion === undefined
			? documents.toSorted().at(-1)
			: (documents.find((name) => name === `openapi.${scenario.latestVersion}.json`) ??
				documents.toSorted().at(-1));
	if (chosen === undefined) return undefined;
	const document = JSON.parse(readFileSync(join(scenario.openapiDir, chosen), "utf8")) as {
		readonly paths?: Readonly<Record<string, Readonly<Record<string, DocumentOperation>>>>;
	};
	const schemas = readFileSync(join(scenario.serverDir, "schemas.gen.ts"), "utf8");

	// The routes the generated server registers, as Hono reports them: method and composed path.
	const server = (await import(join(scenario.serverDir, "app.gen.ts"))) as {
		registerRoutes: (app: unknown, handlersFor: unknown, deps: unknown) => Hono;
	};
	const noop = (): undefined => undefined;
	const app = server.registerRoutes(
		new Hono(),
		() => new Proxy({}, { get: () => noop }),
		new Proxy({}, { get: () => noop }),
	);
	const routes = app.routes.filter((route) => route.method !== "ALL");
	const unreserved = (path: string): string => path.replaceAll(/\{\.\+\}/g, "");

	const checks: string[] = [];
	let compared = 0;
	let skipped = 0;
	let opaqueMedia = 0;
	for (const [path, item] of Object.entries(document.paths ?? {})) {
		const honoPath = path.replaceAll(/\{([^}]+)\}/g, ":$1");
		for (const [verb, operation] of Object.entries(item)) {
			if (verb === "parameters" || verb === "head") {
				if (verb === "head") skipped++;
				continue;
			}
			const id = operation.operationId;
			const responses = Object.entries(operation.responses ?? {});
			const arms = id === undefined ? new Map<string, string | undefined>() : armsOf(schemas, id);
			// A merged negotiation entry names no single operation's arms.
			if (id === undefined || arms.size === 0 || responses.length === 0) {
				skipped++;
				continue;
			}
			// A GET sharing its route with a HEAD answers for both, so its route type is theirs together.
			if (item["head"] !== undefined && verb === "get") {
				skipped++;
				continue;
			}
			const matches = [
				...new Set(
					routes
						.filter(
							(route) =>
								route.method === verb.toUpperCase() && unreserved(route.path).endsWith(honoPath),
						)
						.map((route) => route.path),
				),
			];
			if (matches.length === 0) {
				skipped++;
				continue;
			}
			const members = responses.map(([status, response]) => {
				const types = Object.keys(response.content ?? {});
				const schema = arms.get(status);
				const json = types.some(isJson) && schema !== undefined;
				const other =
					types.some((type) => !isJson(type)) || (types.length > 0 && schema === undefined);
				return { status, types, schema, json, other };
			});
			if (members.some(({ types }) => types.some((type) => !isJson(type) && !isText(type)))) {
				opaqueMedia++;
			}
			/**
			 * The STATUSES each key answers, from `RouteConfigToTypedResponse`. Every key is given a JSON
			 * placeholder when it has any content, because it types an unrecognised media type as a bare
			 * `Response`, which carries no status to read.
			 */
			const entry = (member: (typeof members)[number]): string =>
				`${keyOf(member.status)}: ${member.types.length > 0 ? "J" : "N"}`;
			const statusesOf = (entries: readonly string[]): string =>
				`StatusesOf<RouteConfigToTypedResponse<Cfg<{ ${entries.join("; ")} }>>>`;
			const tag = `${id}_${verb}`.replaceAll(/[^\w]/g, "_");
			const exact = members.filter(({ status }) => /^\d+$/.test(status));
			const ranges = members.filter(({ status }) => /^\dXX$/.test(status));
			const exactUnion =
				exact.length === 0 ? "never" : exact.map(({ status }) => status).join(" | ");
			const statusType = (member: (typeof members)[number]): string => {
				if (/^\d+$/.test(member.status)) return member.status;
				if (member.status !== "default") {
					// Deviation 1: an exact status is not also a member of its range.
					return `Exclude<${statusesOf([entry(member)])}, ${exactUnion}>`;
				}
				const others = [...exact, ...ranges].map((other) => statusesOf([entry(other)]));
				return `Exclude<${statusesOf(members.map(entry))}, ${others.length === 0 ? "never" : others.join(" | ")}>`;
			};
			const pairs = members.flatMap((member) => {
				const body = `JSONParsed<z.infer<typeof S.${member.schema ?? "never"}>>`;
				return [
					...(member.json ? [`Pair<${statusType(member)}, ${body}>`] : []),
					...(member.other || member.types.length === 0
						? [`Pair<${statusType(member)}, "not-json">`]
						: []),
				];
			});
			checks.push(`
type Expected_${tag} = Normalise<
	${pairs.map((pair) => `| ${pair}`).join("\n\t")}
>;`);
			for (const path of matches) {
				compared++;
				checks.push(`
type Actual_${tag}_${compared} = Normalise<Endpoints<Schema[${JSON.stringify(path)}][${JSON.stringify(`$${verb}`)}]>>;
export type Agrees_${tag}_${compared} = Holds<Identical<Expected_${tag}, Actual_${tag}_${compared}>>;`);
			}
		}
	}
	if (compared === 0) return { source: "", compared, skipped, opaqueMedia };
	const source = `import type { RouteConfigToTypedResponse } from "@hono/zod-openapi";
import type { TypedResponse } from "hono";
import type { ExtractSchema } from "hono/types";
import type { ContentlessStatusCode, InfoStatusCode, UnofficialStatusCode } from "hono/utils/http-status";
import type { JSONParsed } from "hono/utils/types";
import type { z, ZodType } from "zod";
import type { Operations, registerRoutes } from "./app.gen.js";
import type * as S from "./schemas.gen.js";

type Schema = ExtractSchema<ReturnType<typeof registerRoutes<unknown, Operations>>>;
type Cfg<Responses> = { method: "get"; path: "/oracle"; responses: Responses };
type J = { description: ""; content: { "application/json": { schema: ZodType } } };
type N = { description: "" };
type StatusesOf<R> = R extends TypedResponse<unknown, infer St, string> ? St : never;
type Pair<St, B> = St extends unknown ? { readonly status: St; readonly body: B } : never;
type Endpoints<T> = T extends { output: infer B; outputFormat: infer F; status: infer St } ? Pair<St, F extends "json" ? B : "not-json"> : never;
/** Deviations 2 and 3, applied to both sides alike. */
type Normalise<P> = P extends { readonly status: infer St; readonly body: infer B }
	? St extends InfoStatusCode | UnofficialStatusCode
		? never
		: St extends ContentlessStatusCode
			? B extends "not-json" ? P : never
			: P
	: never;
type Identical<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Holds<T extends true> = T;
${checks.join("\n")}
`;
	return { source, compared, skipped, opaqueMedia };
}

describe("the responses a client sees are the ones @hono/zod-openapi requires", () => {
	it("agrees for every route the corpus declares", async () => {
		let compared = 0;
		let skipped = 0;
		let opaqueMedia = 0;
		const disagreements: string[] = [];
		for (const scenario of compiled) {
			const plan = await planFor(scenario);
			if (plan === undefined) continue;
			compared += plan.compared;
			skipped += plan.skipped;
			opaqueMedia += plan.opaqueMedia;
			if (plan.compared === 0) continue;
			writeFileSync(join(scenario.serverDir, "oracle.ts"), plan.source);
			const config = join(scenario.serverDir, "tsconfig.oracle.json");
			writeFileSync(
				config,
				JSON.stringify({
					compilerOptions: {
						target: "es2023",
						lib: ["es2023", "dom"],
						module: "nodenext",
						moduleResolution: "nodenext",
						strict: true,
						exactOptionalPropertyTypes: true,
						noEmit: true,
						skipLibCheck: true,
						types: [],
					},
					include: ["./oracle.ts"],
				}),
			);
			try {
				execFileSync(join(packageRoot, "node_modules", ".bin", "tsc"), ["-p", config], {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				});
			} catch (error) {
				const asExec = error as { stdout?: string; stderr?: string };
				const ours = `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`
					.split("\n")
					.filter((line) => line.includes("oracle.ts("));
				if (ours.length > 0) disagreements.push(`${scenario.scenario.name}\n${ours.join("\n")}`);
			}
		}
		expect(disagreements, disagreements.join("\n\n")).toEqual([]);
		/**
		 * Floors, because an oracle that compares nothing agrees with everything. Measured at 619 routes
		 * compared, 18 skipped and 38 operations carrying a media type that is not JSON; the skips are an
		 * upper bound, since a lookup that stopped matching would move routes from compared to skipped.
		 */
		expect(compared).toBeGreaterThanOrEqual(600);
		expect(opaqueMedia).toBeGreaterThanOrEqual(30);
		expect(skipped).toBeLessThanOrEqual(25);
	});
});
