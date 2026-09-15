import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { compileEmittedSet } from "./support/emitted-set.js";

/**
 * **Every call in the generated Zod must be derivable from the document.**
 *
 * **This is the assertion the governing rule always claimed and did not have, twice.** "Nothing
 * in the runtime validator is unsayable in the document" sat in the original emitter's plan for its
 * entire life, cited constantly, never built. It was eventually built there; then this package was
 * extracted without it, and the README went on claiming the class was asserted rather than trusted.
 *
 * That is the worst arrangement available: a rule everybody cites, nothing checks, and which
 * therefore drifts exactly as far as attention lapses. It matters more now, not less,
 * `z.preprocess` is admitted for collection formats, and an unenforced rule with a fresh exception
 * is how a dialect starts.
 *
 * **The class, not a list of members.** Anything that computes rather than describes is refused,
 * with one carve-out, stated as a SHAPE a machine can check rather than as a file name.
 */

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

/** Zod calls that enforce or rewrite something JSON Schema cannot state. */
const NOT_DERIVABLE = /\.(refine|superRefine|transform|catch|pipe|brand)\(/g;

/**
 * The one permitted `.refine`, written as the only form it may take.
 *
 * **A `HttpPart<File>` is a file, and this establishes it.** `@typespec/openapi3` publishes a bare
 * `{}` for such a part - in 3.1, and even where the part declares a content type. That is OpenAPI's
 * IDIOM for binary content in a multipart body rather than a statement that any value is
 * acceptable, and the transport agrees: Hono types a multipart part as `string | File` and nothing
 * else. So this refuses exactly one thing, a text field where the spec declared a file, and that
 * request is malformed against the spec the document was projected from. A spec that means "either"
 * writes `HttpPart<File | string>`, so nothing becomes inexpressible.
 *
 * **Duplicated from `typespec-http-zod`'s copy of this suite deliberately.** That package emits the
 * schema; this one embeds it in a server. Each grades the output IT produces, and a rule enforced in
 * one place only is a rule the other can drift away from. Written out literally in both, rather than
 * imported, so neither oracle derives its expectation from the code it grades.
 */
const MULTIPART_FILE_REFINE =
	/z\.unknown\(\)\.refine\(\(value\): value is \{ name: string; type: string; arrayBuffer: \(\) => Promise<ArrayBuffer> \} => typeof value === "object" && value !== null && "name" in value && typeof value\.name === "string" && "type" in value && typeof value\.type === "string" && "arrayBuffer" in value && typeof value\.arrayBuffer === "function"\)/g;

/**
 * The permitted `z.preprocess` shapes. Each written as the only form it may take.
 *
 * Every one of these undoes a TRANSPORT ENCODING before validation, so the document's own schema and
 * every constraint on it still run afterwards. A `preprocess` doing anything else, coercing,
 * defaulting, renaming, is still refused, because the document does not say it.
 *
 * **The line between "decoding" and "coercing" is whether an invalid value can become valid.**
 * `z.coerce.number()` is the forbidden thing and it is one character of effort: `Number("")` is `0`,
 * so `?limit=` would satisfy a required integer that the document forbids. Every decoder below passes
 * a malformed value through UNCHANGED, so it fails against the published schema and reports the error
 * the document justifies. That is the property that makes them derivable; it is not a matter of taste.
 */

/** A list flattened into one value by OpenAPI's `style`/`explode`, split back apart. */
const DELIMITER_SPLIT =
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? raw\.split\("(?:[^"\\]|\\.)*"\) : raw\), /g;

/**
 * One occurrence of an exploded list, boxed into the list the document describes.
 *
 * `style: form, explode: true` is OpenAPI's DEFAULT for a query parameter, so `?topics=a` is a valid
 * one-element array and the document says so by omitting `explode` rather than by stating it.
 * `zValidator` delivers a bare string for one occurrence and an array for several, so the emitted
 * `z.array()` accepted `?topics=a&topics=b` and refused `?topics=a`: the same list decided by its
 * length, which no document describes.
 *
 * Admitted on the same terms as the split below it. It reshapes the wire into what the document
 * already describes and runs every constraint afterwards, rather than relaxing one.
 */
const EXPLODED_BOX = /z\.preprocess\(\(raw\) => \(typeof raw === "string" \? \[raw\] : raw\), /g;

/**
 * A path, query or header scalar decoded from the only thing HTTP can carry: text.
 *
 * **`type: integer` on a query parameter describes the DECODED value, not the wire.** Without this
 * the emitted `z.number().int()` met `"1"` and refused it. Measured against a Petstore server under
 * `wrangler dev`, `GET /pet/1` answered 400 to every conformant caller while `GET /user/zach` answered
 * 200. Same class as the split above: the transport carries text, the document describes the value.
 */
const SCALAR_DECODE = [
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" && raw\.trim\(\) !== "" && Number\.isFinite\(Number\(raw\)\) \? Number\(raw\) : raw\), /g,
	/z\.preprocess\(\(raw\) => \(raw === "true" \? true : raw === "false" \? false : raw\), /g,
	/z\.preprocess\(\(raw\) => \(Array\.isArray\(raw\) \? raw\.map\(\(raw\) => \((?:typeof raw === "string" && raw\.trim\(\) !== "" && Number\.isFinite\(Number\(raw\)\) \? Number\(raw\) : raw|raw === "true" \? true : raw === "false" \? false : raw)\)\) : raw\), /g,
];

/**
 * A multipart part declared as JSON, decoded from the text a form carries.
 *
 * A form part arrives as a string, and a part whose content type is `application/json` carries JSON
 * text: `Request.formData()` hands `address` over as `"{\"city\":\"x\"}"`, which the part's object
 * schema refused. Text that is not JSON is reported as such rather than passed on, and valid JSON still
 * runs every constraint the part's schema states. Emitted by `typespec-http-zod`, whose own vocabulary
 * arm pins the same shape.
 */
const JSON_PART_DECODE =
	/z\.preprocess\(\(raw, ctx\) => \{ if \(typeof raw !== "string"\) return raw; try \{ return JSON\.parse\(raw\); \} catch \{ ctx\.addIssue\(\{ code: "custom", message: "Invalid JSON in a multipart part" \}\); return z\.NEVER; \} \}, /g;

/** A JSON string literal, as `JSON.stringify` writes one into emitted source. */
const JSON_STRING = String.raw`"(?:[^"\\]|\\.)*"`;
/** A JSON array of such strings. */
const JSON_STRINGS = String.raw`\[(?:${JSON_STRING}(?:,${JSON_STRING})*)?\]`;

/**
 * The library's RFC 6570 decoders, copied from `typespec-http-zod/test/vocabulary.test.ts` for the
 * reason every shape here is: the server embeds what the library emits, and each grades what it
 * produces. A path value undone from its segment text, and a form-exploded query object gathered back
 * under its name; both refuse text that is not the declared expansion, so neither widens a parameter.
 */
const URI_EXPANSION_DECODE = new RegExp(
	String.raw`z\.preprocess\(\(raw, ctx\) => uriExpansion\(raw, ctx, \{ prefix: ${JSON_STRING}, suffix: ${JSON_STRING}, operator: "(?:|\+|#|\.|/|;)", name: ${JSON_STRING}, explode: (?:true|false), shape: "(?:scalar|list|record)", values: "(?:number|boolean|)" \}\), `,
	"g",
);
const EXPLODED_QUERY_GATHER = new RegExp(
	String.raw`z\.preprocess\(\(raw\) => explodedQuery\(raw, \{ name: ${JSON_STRING}, others: ${JSON_STRINGS}, keys: (?:null|${JSON_STRINGS}), numbers: ${JSON_STRINGS}, booleans: ${JSON_STRINGS}, values: "(?:number|boolean|)" \}\), `,
	"g",
);

/**
 * A `content-type` header reduced to the media type, discarding the parameters the document does not
 * mention.
 *
 * **Refusing parameters is enforcing something the document cannot state**, and it made every
 * multipart request fail. The boundary parameter RFC 2046 requires is exactly what the literal
 * refused. Both spellings are permitted: the lowercasing one applies when the declared literal is
 * itself lowercase, which is every literal openapi3 publishes across this corpus.
 */
const MEDIA_TYPE_DECODE = [
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? \(raw\.split\(";"\)\[0\] \?\? ""\)\.trim\(\)\.toLowerCase\(\) : raw\), /g,
	/z\.preprocess\(\(raw\) => \(typeof raw === "string" \? \(raw\.split\(";"\)\[0\] \?\? ""\)\.trim\(\) : raw\), /g,
];

/** How many times a set of shapes appears in one file. */
function countOf(source: string, patterns: readonly RegExp[]): number {
	return patterns.reduce((total, pattern) => total + (source.match(pattern) ?? []).length, 0);
}

describe("the generated validator says only what the document can say", () => {
	let files: string[] = [];

	beforeAll(async () => {
		// Compiled here, by this suite, into a directory only this suite writes. See `emitted-set.ts`.
		files = await compileEmittedSet("vocabulary");
	}, 600_000);

	it("has emitted output to inspect at all", () => {
		/**
		 * **These floors were an order of magnitude under what is actually swept, and had been since
		 * before the sweep was made deterministic.** The arms were reading 315 files against a floor of
		 * 20, 69 generated servers against 10, and 17 delimiter splits against 5, numbers that would
		 * have gone on passing through almost any regression. A floor that far under the measurement is
		 * a floor in name only, and this file exists precisely to stop an arm reporting agreement about
		 * nothing.
		 *
		 * Now at roughly half the measured value: loose enough to survive a corpus bump that removes
		 * scenarios, tight enough to fail a real reduction in coverage. The same correction was made in
		 * `typespec-http-zod`, for the same reason.
		 */
		// Without this the whole file passes the day the sweep stops producing anything.
		expect(files.length).toBeGreaterThanOrEqual(150);
	});

	it("has generated SERVERS to inspect, not only validators", () => {
		/**
		 * **The arms below would pass on validators alone.** This package's own artefact is
		 * `app.gen.ts`, and it is the one that could acquire a non-derivable call, a hand-rolled
		 * coercion in a handler, a `.transform()` smuggled into a response. Checking only what the
		 * library wrote would leave this package's output ungraded by its own rule.
		 */
		expect(files.filter((file) => file.endsWith("app.gen.ts")).length).toBeGreaterThanOrEqual(30);
	});

	it("uses no Zod call that enforces something the document cannot state", () => {
		/**
		 * Empty, not a count. An allowance that survives the thing it allowed has stopped guarding
		 * anything, which is why the original wrote this as a number first: reaching zero had to fail
		 * here rather than pass quietly.
		 */
		const offenders = files.flatMap((file) => {
			// The permitted shape is removed first, so anything left is by definition not it.
			const source = readFileSync(file, "utf8").replaceAll(MULTIPART_FILE_REFINE, "");
			return [...source.matchAll(NOT_DERIVABLE)].map((match) => `${match[1]} in ${file}`);
		});
		expect(offenders).toEqual([]);
	});

	it("finds the multipart file refinements it is meant to permit", () => {
		/**
		 * **Paired with the arm above, which passes trivially if the emitter stops emitting any.** An
		 * exemption that outlives the thing it exempted has stopped guarding anything, and would then
		 * be stripping text that has come to mean something else.
		 */
		const refinements = files.reduce(
			(total, file) =>
				total + (readFileSync(file, "utf8").match(MULTIPART_FILE_REFINE) ?? []).length,
			0,
		);
		expect(refinements).toBeGreaterThanOrEqual(4);
	});

	it("permits `z.preprocess` only as a wire decode of a known shape", () => {
		/**
		 * **The permitted shapes are lifted verbatim from `typespec-http-zod`, which owns the rule.**
		 * The schemas being graded here are that package's output; this package grades them too because
		 * its own `app.gen.ts` sits beside them and could acquire a non-derivable call of its own.
		 * Copying the shapes rather than loosening the arm is what keeps the two in step.
		 */
		const permitted = [
			DELIMITER_SPLIT,
			EXPLODED_BOX,
			...SCALAR_DECODE,
			...MEDIA_TYPE_DECODE,
			JSON_PART_DECODE,
			URI_EXPANSION_DECODE,
			EXPLODED_QUERY_GATHER,
		];
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			const all = (source.match(/z\.preprocess\(/g) ?? []).length;
			expect(countOf(source, permitted), `an unrecognised z.preprocess in ${file}`).toBe(all);
		}
	});

	it("finds the delimiter splits it is meant to permit", () => {
		// Paired with the arm above, which passes trivially if the emitter stops emitting any.
		const splits = files.reduce(
			(total, file) => total + (readFileSync(file, "utf8").match(DELIMITER_SPLIT) ?? []).length,
			0,
		);
		expect(splits).toBeGreaterThanOrEqual(8);
	});

	it("declares no schema of its own in the server it generates", () => {
		/**
		 * **The split's load-bearing property, asserted here as well as in the reference suite.**
		 * Every validator `app.gen.ts` names was declared by `typespec-http-zod`. If this package ever
		 * declares one, two emitters are minting identifiers and agreeing by coincidence, which is the
		 * coupling the split exists to remove.
		 */
		const servers = files.filter((file) => file.endsWith("app.gen.ts"));
		const offenders = servers.filter((file) =>
			/^export const \w+(Schema|Path|Query|Header|Body|Response|Responses) = /m.test(
				readFileSync(file, "utf8"),
			),
		);
		expect(offenders).toEqual([]);
	});

	it("imports only frameworks and its own siblings", () => {
		/**
		 * **The dependency points one way, and nothing else enforced it.** The whole wiring design
		 * turns on the application importing the generated file, implementing what it declares, and
		 * passing it in. The rejected alternative. The generated file importing the app's handlers,
		 * reads better on day one and fails by generation three, because an operation REMOVED from the
		 * spec just drops its import and leaves an orphan compiling forever.
		 */
		const servers = files.filter((file) => file.endsWith("app.gen.ts"));
		/**
		 * **The runtime is a sibling now, and nothing else is.** `runtime-module` used to point the
		 * generated file anywhere a consumer chose, so this allowed any `runtime*.js`; the option is
		 * refused and `runtime.gen.ts` is always emitted beside it, so the allowance is gone with it.
		 * `hono/utils/http-status` is Hono's own published status-code types, which the result unions
		 * name.
		 */
		const allowed = (specifier: string): boolean =>
			specifier === "hono" ||
			specifier === "hono/utils/http-status" ||
			specifier === "zod" ||
			specifier === "@hono/zod-validator" ||
			/^\.\/[\w.-]+\.gen\.js$/.test(specifier);
		const strays = servers.flatMap((file) =>
			[...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)]
				.map((match) => match[1] ?? "")
				.filter((specifier) => !allowed(specifier))
				.map((specifier) => `${specifier} in ${file}`),
		);
		expect(strays).toEqual([]);
	});

	it("ships no decorator of its own for a spec to depend on", () => {
		/**
		 * **The other half, and without it the arm above can be satisfied by a spec that simply
		 * stopped using the decorator.** Four existed in this emitter's ancestor, `@trimmed`, `@loose`,
		 * `@externalValues`, `@refine`, and each let a spec state something `@typespec/openapi3` could
		 * not publish, so the emitted validator enforced a rule no caller reading the contract could see.
		 *
		 * Asserted against the package's own TypeSpec entry point, because that is the only thing a
		 * consumer's `import` can reach. A `$decorators` export there is a second contract, whatever it
		 * happens to contain.
		 */
		const entry = readFileSync(join(packageRoot, "lib", "main.tsp"), "utf8");
		expect(entry).not.toMatch(/^\s*import\s+"\.\/decorators\.tsp"/m);
		// The DECLARATION, not the word: the docblock beside it explains why there is none, and a
		// prose match would make this arm impossible to satisfy while explaining itself.
		expect(readFileSync(join(packageRoot, "src", "tsp-index.ts"), "utf8")).not.toMatch(
			/^\s*(?:export\s+)?const\s+\$decorators\b/m,
		);
		expect(existsSync(join(packageRoot, "lib", "decorators.tsp"))).toBe(false);
		// `$lib` carries no `state` key either: state is what a decorator writes into.
		expect(readFileSync(join(packageRoot, "src", "lib.ts"), "utf8")).not.toMatch(/^\s*state:/m);
	});
});
