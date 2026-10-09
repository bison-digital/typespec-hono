import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, NodeHost, type Diagnostic } from "@typespec/compiler";
import { describe, expect, it } from "vitest";

/** **A diagnostic about one operation on a shared route points at that operation.** See `shared.tsp`. */

const here = fileURLToPath(new URL(".", import.meta.url));

describe("an operation on a shared route is diagnosed as itself", () => {
	it("raises a member's diagnostic against that member, whichever position it holds", async () => {
		const outDir = join(here, ".out", "shared");
		const program = await compile(NodeHost, join(here, "shared.tsp"), {
			outputDir: outDir,
			emit: ["typespec-hono"],
			options: { "typespec-hono": { "emitter-output-dir": outDir } },
		});
		const named = (diagnostic: Diagnostic): string | undefined => {
			const target = diagnostic.target;
			return typeof target === "object" && "kind" in target && target.kind === "Operation"
				? target.name
				: undefined;
		};
		const raised = program.diagnostics
			.filter((diagnostic) => diagnostic.code === "typespec-hono/unvalidated-response-media-type")
			.map((diagnostic) => [/'([^']+)'/.exec(diagnostic.message)?.[1], named(diagnostic)]);
		expect(raised.toSorted()).toEqual([
			["reportAsXml", "reportAsXml"],
			["statusAsXml", "statusAsXml"],
		]);
	}, 300_000);
});
