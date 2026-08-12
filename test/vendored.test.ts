import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **The shared fixture has not drifted from the copy it was vendored from.**
 *
 * ⚠️ **Two copies in two repositories with nothing comparing them is drift waiting to happen**, and
 * the failure is silent: each suite passes against its own copy while the two specs describe
 * different services, so "both packages agree about the reference service" quietly stops being true.
 *
 * The digest lives in `PROVENANCE.md` beside the file — the same treatment this codebase already gives
 * vendored reference documents, which are committed with provenance and never fetched, because a
 * suite that reaches the network decides its own result on a value it did not supply.
 */
const here = fileURLToPath(new URL(".", import.meta.url));

describe("the vendored reference service matches its recorded digest", () => {
	it("has a provenance record naming a digest", () => {
		const provenance = readFileSync(join(here, "reference", "PROVENANCE.md"), "utf8");
		// Non-vacuity: without this the arm below passes on a file that records nothing.
		expect(provenance).toMatch(/sha256\s+[0-9a-f]{64}/);
	});

	it("matches it byte for byte", () => {
		const provenance = readFileSync(join(here, "reference", "PROVENANCE.md"), "utf8");
		const recorded = /sha256\s+([0-9a-f]{64})/.exec(provenance)?.[1];
		const actual = createHash("sha256")
			.update(readFileSync(join(here, "reference", "service.tsp")))
			.digest("hex");
		expect(actual, "service.tsp has drifted from the copy recorded in PROVENANCE.md").toBe(recorded);
	});
});
