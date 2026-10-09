import { Hono } from "hono";
import { registerRoutes, type Operations } from "../reference/.out/service-wired/app.gen.js";
import type { RouteDeps } from "../reference/.out/service-wired/runtime.gen.js";
import type { WireInputs, WireResults } from "../reference/.out/service-wired/contracts.barrel.js";

/**
 * **A gateway in front of a backend typed by the contract types alone, question 4.**
 *
 * The shape one consumer runs in production: a Hono gateway reaching backends over Workers service
 * bindings, each backend a framework-free package that cannot import this server's types. Its
 * methods take `WireInputs[op]` and return `WireResults[op]` - the operation's input, and its result
 * with each status paired to its body - and every handler below forwards what it received and
 * returns what came back, with nothing between.
 *
 * **This file exists to be COMPILED.** Before the contract types stated results, such a backend typed
 * its result `{ status: number }` and every handler mapped it; before they placed bodies as the
 * handler receives them, every handler re-flattened its input. Each of those was code a consumer
 * wrote to work around this package, and none of it is here.
 *
 * **Nothing here casts**, for the same reason as `consumer.fixture.ts`.
 */
interface Backend {
	readonly [K: string]: unknown;
	readonly readWidget: (input: WireInputs["readWidget"]) => Promise<WireResults["readWidget"]>;
	readonly listWidgets: (input: WireInputs["listWidgets"]) => Promise<WireResults["listWidgets"]>;
	readonly createWidget: (
		input: WireInputs["createWidget"],
	) => Promise<WireResults["createWidget"]>;
	readonly deleteWidget: (
		input: WireInputs["deleteWidget"],
	) => Promise<WireResults["deleteWidget"]>;
	readonly setFlags: (input: WireInputs["setFlags"]) => Promise<WireResults["setFlags"]>;
	readonly addShape: (input: WireInputs["addShape"]) => Promise<WireResults["addShape"]>;
	readonly addTree: (input: WireInputs["addTree"]) => Promise<WireResults["addTree"]>;
	readonly health: (input: WireInputs["health"]) => Promise<WireResults["health"]>;
	readonly widgetExists: (
		input: WireInputs["widgetExists"],
	) => Promise<WireResults["widgetExists"]>;
	readonly Report_asJson: (
		input: WireInputs["Report_asJson"],
	) => Promise<WireResults["Report_asJson"]>;
	readonly Report_asText: (
		input: WireInputs["Report_asText"],
	) => Promise<WireResults["Report_asText"]>;
}

declare const backend: Backend;
declare const deps: RouteDeps;

const forwarding = {
	readWidget: (_ctx: unknown, input) => backend.readWidget(input),
	listWidgets: (_ctx: unknown, input) => backend.listWidgets(input),
	createWidget: (_ctx: unknown, input) => backend.createWidget(input),
	deleteWidget: (_ctx: unknown, input) => backend.deleteWidget(input),
	setFlags: (_ctx: unknown, input) => backend.setFlags(input),
	addShape: (_ctx: unknown, input) => backend.addShape(input),
	addTree: (_ctx: unknown, input) => backend.addTree(input),
	health: (_ctx: unknown, input) => backend.health(input),
	widgetExists: (_ctx: unknown, input) => backend.widgetExists(input),
	Report_asJson: (_ctx: unknown, input) => backend.Report_asJson(input),
	Report_asText: (_ctx: unknown, input) => backend.Report_asText(input),
} satisfies Operations;

export const gateway = registerRoutes(new Hono(), () => forwarding, deps);

/** Every operation the service declares is forwarded: one missing here is a compile error above. */
export type Covered = [Exclude<keyof Operations, keyof typeof forwarding>] extends [never]
	? true
	: never;
export const covered: Covered = true;
