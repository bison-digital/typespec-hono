import "@typespec/http";

using Http;

/**
 * **A path parameter that carries slashes, which is what a hierarchical identifier is.**
 *
 * An Obsidian note is `areas/health.md`; an S3 key and a GitHub file path are the same shape. RFC
 * 6570 spells it `{+path}`, TypeSpec accepts that in a `@route` template, and `@typespec/http`
 * resolves it to a plain `/vault/{path}` with `allowReserved` set on the parameter. Hono spells the
 * route `:path{.+}`.
 *
 * **The document cannot say it, at any OpenAPI version including 3.2**, so openapi3 publishes
 * `/vault/{path}` and warns. That divergence is licensed and stated in `docs/reference.md` rather
 * than hidden, and it is a SUPERSET rather than a contradiction: measured, a greedy route answers
 * both `/vault/areas/health.md` and the percent-encoded `/vault/areas%2Fhealth.md` a client
 * generated from the document would send, and yields the same value for each.
 */
@service(#{ title: "Vault" })
namespace Vault;

model Note {
  path: string;
  body: string;
}

/** The plain case: greedy parameter at the end of the template. */
@route("/vault/{+path}")
@get
op readNote(@path path: string): Note;

/** Mid-position: a literal segment follows the greedy parameter. */
@route("/vault/{+path}/move")
@post
op moveNote(@path path: string): Note;

/** A renamed parameter, so the WIRE name is what reaches the route rather than the property name. */
@route("/file/{+note-path}")
@get
op readFile(@path("note-path") notePath: string): Note;

/** Mixed: one ordinary parameter and one greedy, proving the fact is per parameter. */
@route("/repo/{owner}/{+ref}")
@get
op readRef(@path owner: string, @path ref: string): Note;

/** The control: an ordinary parameter must stay ordinary. */
@route("/notes/{id}")
@get
op readById(@path id: string): Note;
