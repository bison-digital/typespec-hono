import { describe, expect, it } from "vitest";
import { EmitterOptionsSchema as httpZodOptions } from "typespec-http-zod";
import { EmitterOptionsSchema } from "../src/lib.js";

/**
 * **Every option the library accepts reaches it through this emitter.**
 *
 * **This emitter runs the whole of `typespec-http-zod`, so its option schema is the library's plus
 * whatever a server needs.** Written as a second hand-kept list, an option added there would be
 * rejected here as unknown, or, worse, accepted and silently dropped, producing output that is wrong
 * in a way no test of either package would see.
 *
 * Asserted as a CLASS over the published schema's own keys, never as a list of names. The same rule
 * that has caught defects three times in this codebase: assert the set, not its members.
 */
describe("the option schema is derived from the library's, not restated", () => {
	const theirs = Object.keys(httpZodOptions.properties ?? {});
	const ours = Object.keys(EmitterOptionsSchema.properties ?? {});

	it("has options to compare at all", () => {
		expect(theirs.length).toBeGreaterThanOrEqual(5);
	});

	it("forwards every key the library publishes", () => {
		expect(theirs.filter((key) => !ours.includes(key)).toSorted()).toEqual([]);
	});

	it("still refuses an option neither package declares", () => {
		// `additionalProperties: false` is what turns a typo into a diagnostic rather than silence.
		expect(EmitterOptionsSchema.additionalProperties).toBe(false);
	});

	it("forwards the per-service overrides too, not only the top level", () => {
		/**
		 * **The nested map is a second place the same list can drift.** A spec with two `@service`
		 * namespaces configures each one separately; an option forwarded at the top level and dropped
		 * inside `services` is wrong for exactly the consumers who need it most.
		 */
		const nested = (schema: unknown): string[] =>
			Object.keys(
				(
					schema as {
						properties?: { services?: { additionalProperties?: { properties?: object } } };
					}
				).properties?.services?.additionalProperties?.properties ?? {},
			);
		const theirNested = nested(httpZodOptions);
		expect(theirNested.length).toBeGreaterThanOrEqual(5);
		expect(theirNested.filter((key) => !nested(EmitterOptionsSchema).includes(key))).toEqual([]);
	});
});
