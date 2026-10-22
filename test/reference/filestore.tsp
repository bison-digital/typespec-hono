import "@typespec/http";

using Http;

/**
 * **A path parameter that carries slashes, which is what a hierarchical identifier is.**
 *
 * A stored file is `reports/summary.pdf`; an S3 key and a GitHub file path are the same shape. RFC
 * 6570 spells it `{+path}`, TypeSpec accepts that in a `@route` template, and `@typespec/http`
 * resolves it to a plain `/files/{path}` with `allowReserved` set on the parameter. Hono spells the
 * route `:path{.+}`.
 *
 * **The document cannot say it, at any OpenAPI version including 3.2**, so openapi3 publishes
 * `/files/{path}` and warns. That divergence is licensed and stated in `docs/reference.md` rather
 * than hidden, and it is a SUPERSET rather than a contradiction: measured, a greedy route answers
 * both `/files/reports/summary.pdf` and the percent-encoded `/files/reports%2Fsummary.pdf` a client
 * generated from the document would send, and yields the same value for each.
 */
@service(#{ title: "File store" })
namespace FileStore;

model StoredFile {
  path: string;
  content: string;
}

/** The plain case: greedy parameter at the end of the template. */
@route("/files/{+path}")
@get
op readFile(@path path: string): StoredFile;

/** Mid-position: a literal segment follows the greedy parameter. */
@route("/files/{+path}/move")
@post
op moveFile(@path path: string): StoredFile;

/** A renamed parameter, so the WIRE name is what reaches the route rather than the property name. */
@route("/objects/{+object-key}")
@get
op readObject(@path("object-key") objectKey: string): StoredFile;

/** Mixed: one ordinary parameter and one greedy, proving the fact is per parameter. */
@route("/repo/{owner}/{+ref}")
@get
op readRef(@path owner: string, @path ref: string): StoredFile;

/** The control: an ordinary parameter must stay ordinary. */
@route("/folders/{id}")
@get
op readFolder(@path id: string): StoredFile;
