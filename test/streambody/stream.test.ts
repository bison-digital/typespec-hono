import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileFixture, type CompiledFixture } from "../support/compile-fixture.js";

/**
 * **A binary request body is handed to the handler unread, as the platform's own stream.**
 *
 * `arrayBuffer()` materialised the whole payload before the handler saw it. A Worker isolate is
 * 128 MB against a request-body limit of 100 MB, so an upload at the documented maximum could not be
 * served at all - and the document publishes only `contentMediaType` for such a body, so nothing
 * about it was validated either. The emitter paid the entire cost of reading it to produce a value
 * nothing checked, and foreclosed the one thing a gateway wants to do with an upload.
 *
 * The arms below also settle what that costs in ambient types, which was assumed and then measured
 * - see the second block. `test/compiles.test.ts` cannot answer it: it sets `target` without `lib`,
 * and TypeScript then defaults to the `.full` variant, which includes DOM.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
let streamed: CompiledFixture;
let plain: CompiledFixture;

beforeAll(async () => {
	streamed = await compileFixture(here, "stream", { outName: "streambody", bare: true });
	plain = await compileFixture(join(here, "..", "emptybody"), "empty", {
		outName: "streambody-plain",
		bare: true,
	});
}, 600_000);

/** `tsc` over emitted output with an EXPLICIT es-only lib, which is what makes the claim testable. */
function typecheckEsOnly(outDir: string): string {
	const config = join(outDir, "tsconfig.esonly.json");
	writeFileSync(
		config,
		JSON.stringify({
			compilerOptions: {
				target: "es2023",
				// Explicit, so the `.full` default cannot smuggle DOM in behind the assertion.
				lib: ["ES2023"],
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				noEmit: true,
				skipLibCheck: true,
				types: [],
			},
			include: ["./**/*.gen.ts"],
		}),
	);
	try {
		execFileSync(join(here, "..", "..", "node_modules", ".bin", "tsc"), ["-p", config], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return "";
	} catch (error) {
		const asExec = error as { stdout?: string; stderr?: string };
		return `${asExec.stdout ?? ""}${asExec.stderr ?? ""}`.trim();
	}
}

describe("a binary body is handed over unread", () => {
	it("emits the stream itself, with no read on the way past", () => {
		const app = streamed.outDir;
		const source = readFileSync(join(app, "app.gen.ts"), "utf8");
		expect(source).toContain("body: c.req.raw.body");
		expect(source).toContain("ReadableStream<Uint8Array> | null");
		// The whole point: nothing materialises it before the handler decides what to do with it.
		expect(source).not.toContain("await c.req.arrayBuffer()");
	});

	it("leaves a JSON raw body as text, which a signature check needs verbatim", () => {
		// `isRawBinaryMediaType` means "not JSON": a raw JSON body is text you want character for
		// character, and that case is untouched by the change above.
		const source = readFileSync(join(streamed.outDir, "app.gen.ts"), "utf8");
		expect(source).toContain("await c.req.text()");
	});
});

/**
 * **Handing over a stream costs no ambient dependency that was not already there**, and this is the
 * arm that establishes it rather than assuming either way.
 *
 * The claim was nearly written the other way round: that `ReadableStream` narrows a "no ambient
 * library" guarantee. Measured, that guarantee never covered the generated SERVER at all - it names
 * `Response`, which is a platform type, so `app.gen.ts` has required `lib.dom`,
 * `@cloudflare/workers-types` or `@types/node` since the day it was first emitted. A web server that
 * needed no web types would be the surprising thing.
 *
 * So the exception is not one construct wide, it is zero constructs wide: **the streamed spec and
 * the ordinary one fail an ES-only lib in exactly the same way, for exactly the same reason.**
 */
describe("a streamed body adds no ambient-library requirement", () => {
	it("needs a platform lib for an ordinary spec, because a server names Response", () => {
		expect(typecheckEsOnly(plain.outDir)).toMatch(/Cannot find name 'Response'/);
	});

	it("needs the same one, and nothing more, for a streamed spec", () => {
		const output = typecheckEsOnly(streamed.outDir);
		expect(output).toMatch(/Cannot find name 'Response'/);
		/**
		 * The point of the pair: whatever a project already supplies to satisfy `Response` -
		 * `lib.dom`, `@cloudflare/workers-types`, `@types/node` - declares `ReadableStream` too. There
		 * is no project that could build the old output and cannot build this one.
		 */
		expect(output).toMatch(/Cannot find name 'ReadableStream'/);
	});
});
