import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * **What a stranger gets when they install this package.**
 *
 * ⚠️ **Every other test here runs inside the checkout, where that question cannot be asked.** A
 * package resolves its own devDependencies, so a source file importing something it never declared
 * works perfectly — right up until somebody installs it on its own and gets `Cannot find package`.
 * Measured before an arm like this existed: the emitter imported `resolveOperationId` from
 * `@typespec/openapi`, which appeared in `devDependencies` and in no `peerDependencies` at all. The
 * published package would not have run.
 *
 * The generated OUTPUT has the same problem one level out: it imports `zod` into the consumer's
 * project, so that is the consumer's requirement too, and saying so is this manifest's job.
 *
 * ⚠️ **Asserted as a CLASS** — every specifier the source and the output reference — rather than as a
 * list somebody remembers to extend.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
	name: string;
	license?: string;
	repository?: unknown;
	files?: readonly string[];
	exports?: Record<string, Record<string, string>>;
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

/** `@scope/name/sub` → `@scope/name`; `node:fs` and relative paths are not packages. */
function packageOf(specifier: string): string | undefined {
	if (specifier.startsWith(".") || specifier.startsWith("node:")) return undefined;
	// An emitted import line is itself a template literal, so its specifier can be a placeholder —
	// `${runtimeModule}` is decided by the consumer's option, not by this manifest.
	if (specifier.includes("${")) return undefined;
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function sourceFiles(dir: string): string[] {
	return readdirSync(dir)
		.filter((entry) => entry.endsWith(".ts"))
		.map((entry) => join(dir, entry));
}

/** Static `from "x"` and guarded `import("x")` alike — both resolve at run time. */
function specifiersIn(source: string): string[] {
	return [
		...[...source.matchAll(/^import\s[^"']*from\s*"([^"]+)"/gm)].map((match) => match[1] ?? ""),
		...[...source.matchAll(/\bimport\("([^"]+)"\)/g)].map((match) => match[1] ?? ""),
	];
}

describe("the package declares what it needs to run outside this checkout", () => {
	const declared = new Set([
		...Object.keys(manifest.peerDependencies ?? {}),
		...Object.keys(manifest.dependencies ?? {}),
	]);

	it("declares every package `src/` imports", () => {
		const used = new Set<string>();
		for (const file of sourceFiles(join(packageRoot, "src"))) {
			for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
				const owner = packageOf(specifier);
				if (owner !== undefined && owner !== manifest.name) used.add(owner);
			}
		}
		// Non-vacuity: a regex that stops matching would report perfect agreement.
		expect(used.size).toBeGreaterThanOrEqual(3);
		expect([...used].filter((name) => !declared.has(name)).toSorted()).toEqual([]);
	});

	it("declares every package the GENERATED output imports", () => {
		/**
		 * ⚠️ **The output's imports are the consumer's problem, and the consumer learns about them from
		 * this manifest.** Generated validators importing `zod` into a project that does not have it
		 * fail at their build, naming a package they never chose.
		 */
		const emitted: string[] = [];
		const walk = (dir: string): void => {
			let entries: string[];
			try {
				entries = readdirSync(dir);
			} catch {
				return;
			}
			for (const entry of entries) {
				const full = join(dir, entry);
				if (statSync(full).isDirectory()) walk(full);
				else if (entry.endsWith(".gen.ts")) emitted.push(full);
			}
		};
		walk(join(packageRoot, "test"));
		expect(emitted.length).toBeGreaterThanOrEqual(20);

		const used = new Set<string>();
		for (const file of emitted) {
			for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
				const owner = packageOf(specifier);
				// Whatever the consumer pointed `runtime-module` and `contracts-package` at is theirs.
				if (owner === undefined || owner === manifest.name) continue;
				used.add(owner);
			}
		}
		// hono, zod and @hono/zod-validator all reach the consumer's project through the emitted server.
		expect(used.size).toBeGreaterThanOrEqual(3);
		expect([...used].filter((name) => !declared.has(name)).toSorted()).toEqual([]);
	});

	it("marks as optional exactly the peers behind a guarded import", () => {
		/**
		 * ⚠️ **A guarded `import()` that is a REQUIRED peer forces every consumer to install it.**
		 * `@typespec/versioning` and `@typespec/streams` are resolved inside `try`/`catch` precisely so a
		 * spec declaring neither needs neither — the same treatment `@typespec/openapi3` gives them.
		 * Marking one and not the other is how that promise quietly stops being true.
		 */
		const guarded = new Set<string>();
		for (const file of sourceFiles(join(packageRoot, "src"))) {
			for (const match of readFileSync(file, "utf8").matchAll(/\bimport\("([^"]+)"\)/g)) {
				const owner = packageOf(match[1] ?? "");
				if (owner !== undefined) guarded.add(owner);
			}
		}
		const optional = Object.entries(manifest.peerDependenciesMeta ?? {})
			.filter(([, meta]) => meta.optional === true)
			.map(([name]) => name);
		/**
		 * ⚠️ **This package has no guarded imports, and the assertion is that BOTH sets are empty.**
		 * The optional peers belong to `typespec-http-zod`, which is where the guarded `import()` calls
		 * are. Declaring an optional peer here that nothing resolves lazily would be a promise about
		 * behaviour this package does not have.
		 */
		expect(optional.toSorted()).toEqual([...guarded].toSorted());
	});

	it("keeps the runtime free of every build-time import", () => {
		/**
		 * ⚠️ **`./runtime` is what a running SERVER imports.** The main entry is an emitter and pulls in
		 * `@typespec/compiler`; a Worker serving the generated routes must not drag a compiler into its
		 * bundle for the sake of a few declarations.
		 */
		const runtime = readFileSync(join(packageRoot, "src", "runtime.ts"), "utf8");
		const specifiers = specifiersIn(runtime).map(packageOf).filter((name) => name !== undefined);
		expect(specifiers.length).toBeGreaterThanOrEqual(2);
		expect(specifiers.filter((name) => name.startsWith("@typespec/"))).toEqual([]);
	});

	it("depends on the library by a real semver range, never by path", () => {
		/**
		 * ⚠️ **This is the trap the development arrangement invites.** The two packages are developed as
		 * sibling checkouts and resolved locally through a `link:` override — which lives in
		 * `pnpm-workspace.yaml`, precisely so the manifest that gets PUBLISHED never carries it. A
		 * `link:` range in `dependencies` would install as a missing package for every consumer.
		 *
		 * Asserted here rather than trusted, because the failure is silent at development time: the
		 * link is exactly what makes everything work locally.
		 */
		const range = (manifest.dependencies ?? {})["typespec-http-zod"];
		expect(range, "the library must be a declared dependency").toBeDefined();
		expect(range).toMatch(/^[\^~]?\d+\.\d+\.\d+/);
	});
});

describe("the package is publishable", () => {
	let extracted = "";

	beforeAll(() => {
		/**
		 * ⚠️ **`pnpm pack` is the only thing that answers "what actually ships".** `files` is a set of
		 * globs, and a glob that stops matching is indistinguishable from one that matches nothing —
		 * an entry point outside it installs as a missing module. Reading the real tarball is the
		 * difference between checking the manifest and checking the package.
		 */
		const workspace = mkdtempSync(join(tmpdir(), "tsh-pack-"));
		const output = execFileSync("pnpm", ["pack", "--pack-destination", workspace], {
			cwd: packageRoot,
			encoding: "utf8",
		});
		const tarball = output
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.endsWith(".tgz"))
			.at(-1);
		expect(tarball, output).toBeDefined();
		execFileSync("tar", ["-xzf", tarball ?? "", "-C", workspace]);
		extracted = join(workspace, "package");
	}, 300_000);

	afterAll(() => {
		if (extracted !== "") rmSync(join(extracted, ".."), { recursive: true, force: true });
	});

	it("ships every path its own entry points resolve to", () => {
		const targets = Object.values(manifest.exports ?? {}).flatMap((entry) =>
			Object.entries(entry)
				.filter(([condition]) => condition !== "typespec" || true)
				.map(([, path]) => path),
		);
		expect(targets.length).toBeGreaterThanOrEqual(4);
		const missing = targets.filter((path) => !existsSync(join(extracted, path)));
		expect(missing.toSorted(), `missing from the tarball`).toEqual([]);
	});

	it("ships no test material", () => {
		/**
		 * ⚠️ **Test material in a published package becomes de-facto public API, delivered to every
		 * installer forever.** `@typespec/openapi3` excludes `dist/test/**` explicitly; so does this.
		 * It is also why the shared reference fixture is vendored into the other repository rather than
		 * shipped from here — see `test/reference/PROVENANCE.md`.
		 */
		const shipped: string[] = [];
		const walk = (dir: string, prefix: string): void => {
			for (const entry of readdirSync(dir)) {
				const full = join(dir, entry);
				if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
				else shipped.push(`${prefix}${entry}`);
			}
		};
		walk(extracted, "");
		expect(shipped.length).toBeGreaterThanOrEqual(10);
		expect(shipped.filter((path) => /(^|\/)test\//.test(path) || path.endsWith(".test.js"))).toEqual(
			[],
		);
		expect(shipped.filter((path) => path.endsWith(".tsp") && !path.startsWith("lib/"))).toEqual([]);
	});

	it("carries a licence, a readme, and points at its source", () => {
		expect(manifest.license).toBe("MIT");
		expect(manifest.repository).toBeDefined();
		expect(existsSync(join(extracted, "LICENSE"))).toBe(true);
		expect(existsSync(join(extracted, "README.md"))).toBe(true);
	});

	it("declares no dependency by path", () => {
		/**
		 * ⚠️ **A `link:` or `file:` range is a local checkout, and publishing one breaks every
		 * installer.** This package has no runtime dependencies today; the arm exists because the
		 * arrangement that develops it — two sibling repositories linked together — is exactly the one
		 * that invites the mistake, and it costs nothing to hold the line before there is something to
		 * hold it on.
		 */
		for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
			expect(range, `${name} is declared by path`).not.toMatch(/^(link|file|workspace):/);
		}
	});
});
