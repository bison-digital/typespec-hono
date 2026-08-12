import { defineConfig } from "vitest/config";

// The emitter is a build-time tool, not Workers code — plain Node. The suite compiles TypeSpec and
// shells out to `tsc`, so it needs headroom well past the 5s default.
//
// ⚠️ **No `globalSetup`.** Each suite compiles what it needs through its own
// harness. A `globalSetup` naming a file that does not exist fails the whole run before a single
// test is collected.
export default defineConfig({
	test: {
		environment: "node",
		include: ["test/**/*.test.ts"],
		testTimeout: 180_000,
	},
});
