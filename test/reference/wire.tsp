import "@typespec/http";

using Http;

/**
 * **The wire depth fixture, breadth of TRANSPORT ENCODINGS, not breadth of API.**
 *
 * **This exists because HTTP carries text and the document describes values, and nothing in this
 * package's fixtures made the two disagree.** Every path and query parameter in `service.tsp` is a
 * `string`, so the only suite that makes real requests never once sent a value that had to be decoded
 *, and the corpus, which emits 29 numeric query and header parameters, requests none of them. Two
 * live defects sat in that gap and both refused every conformant caller:
 *
 * - `z.number().int()` met `"1"` from `c.req.param()` and answered **400**. Measured against a
 *   Petstore server under `wrangler dev`: `GET /pet/1` and `GET /store/order/1` both 400 while
 *   `GET /user/zach` answered 200.
 * - `z.literal("multipart/form-data")` met `multipart/form-data; boundary=...` and answered **400**,
 *   and RFC 2046 section 5.1.1 makes that boundary mandatory, so **every** syntactically valid multipart
 *   request was refused. 78 `content-type` validators across the corpus were bare literals.
 *
 * Same shape as `constraints.tsp` and for the same reason: the corpus tests protocol behaviour, so a
 * keyword-by-keyword fixture is what makes an arm non-vacuous. **Every parameter form that needs
 * decoding appears exactly once, in the location it is legal in.** The service around them is the
 * smallest thing that makes them reachable.
 *
 * **The `@header contentType` literals matter as much as the numbers.** They are the only place a
 * media type reaches a validator, and a bare literal there enforces "no parameters", which the
 * document does not say, and which the wire routinely violates with `; charset=utf-8`.
 */
@service(#{ title: "Wire" })
namespace Wire;

// A LOCAL fixture, not the vendored `service.tsp`. It is deliberately NOT digest-shared with the
// library's copy: each package grades its own emitted artefacts, and coupling two fixtures that serve
// different oracles is how a change in one repository breaks the other for no reason.

model Item {
  id: string;
  label: string;
}

// --- Numeric and boolean parameters, in every location that carries text ---------------------

@route("/items/{itemId}")
@get
op readItem(
  /** A numeric PATH parameter, `c.req.param()` hands this over as a string, always. */
  @path itemId: int64,

  /** A numeric QUERY parameter. */
  @query limit?: int32,

  /** A floating-point QUERY parameter, which decodes differently from an integer. */
  @query ratio?: float64,

  /** A boolean QUERY parameter: `"true"`/`"false"` on the wire, never a boolean. */
  @query expand?: boolean,

  /** A numeric HEADER, which arrives as text for the same reason. */
  @header("x-max-age") maxAge?: int32,
): Item;

/**
 * **A numeric parameter whose type is a UNION OF LITERALS, which is a different emitted shape.**
 *
 * `size` is a number with three permitted values, so the wire carries `?size=25` and the document
 * describes `25`. The library decided whether to decode by reading the emitted expression, and this
 * shape emits `z.union([z.literal(10), ...])`, which begins with neither prefix it looked for. Every
 * conformant caller got a 400 on a parameter the document plainly describes, fixed in
 * `typespec-http-zod@0.6.0`.
 *
 * It is asserted HERE as well as there because the two suites answer different questions: theirs
 * grades the validator it emits, this one sends a real request through a real router to a real
 * handler. A validator can be right and still be reached by nothing.
 */
@route("/paged")
@get
op listPaged(@query size?: 10 | 25 | 50): Item[];

// --- A collection whose ELEMENTS need decoding after the split -------------------------------

@route("/items")
@get
op listItems(
  /** `?ids=1,2,3`. One string, split into three, each of which is still text. */
  @query(#{ explode: false })
  ids?: int32[],

  /** The same shape carrying booleans, so the element decoder is exercised on both. */
  @query(#{ explode: false })
  flags?: boolean[],
): Item[];

// --- Media types, where the document states a type and the wire adds parameters --------------

@route("/items/json")
@post
op createFromJson(
  /** A caller sending `application/json; charset=utf-8` is conformant and must not be refused. */
  @header contentType: "application/json",

  @body body: Item,
): Item;

/**
 * **Several accepted media types become an ENUM, not a literal, and that form is what a real
 * document produces.** The whole conformance corpus emits single literals only, so a decoder handling
 * `z.literal` alone looked complete against it, while the Swagger Petstore's `addPet` accepts three
 * and went on refusing `application/json; charset=utf-8`.
 */
@route("/items/any")
@post
op createFromAny(
  @header contentType: "application/json" | "application/xml",
  @body body: Item,
): Item;

/**
 * **Two declared media types needing DIFFERENT parsers on ONE operation.**
 *
 * `zValidator`'s target is fixed when the file is generated; which parser applies is decided by the
 * caller's `Content-Type` at request time. Where those two disagree the emitter dispatches on the
 * header instead, which is what `byContentType` is for.
 *
 * **Nothing in this package emitted that path.** Measured across 356 generated `app.gen.ts` files,
 * the whole conformance corpus and every fixture: `byContentType(` appeared **zero** times, so the
 * dispatch shipped in 0.4.0 was graded by nothing, and truncating it in `src/` left the entire suite
 * green. `createFromAny` above looks like this case and is not: `application/xml` has no parser, so
 * one target survives and a single `zValidator` is correct there.
 *
 * This is the Swagger Petstore's `addPet` shape, where 11 of 17 request bodies are not JSON.
 */
@route("/items/either")
@post
op createFromEither(
  @header contentType: "application/json" | "application/x-www-form-urlencoded",

  @body body: Item,
): Item;

model UploadParts {
  file: HttpPart<File>;
  caption: HttpPart<string>;
}

@route("/items/upload")
@post
op upload(
  /**
   * **The boundary parameter is MANDATORY here**, so a literal that refuses parameters refuses
   * every request this operation can possibly receive.
   */
  @header contentType: "multipart/form-data",

  @multipartBody body: UploadParts,
): Item;

/**
 * A body whose media type makes it RAW BYTES rather than base64 inside JSON.
 *
 * **Read with `c.req.text()` this corrupts silently and answers 200.** `text()` UTF-8-decodes, so
 * every byte outside ASCII becomes U+FFFD. Measured on an 18-byte upload: 23 code points arrived,
 * five bytes destroyed. The reader has to be `arrayBuffer()`, and only the media type says so.
 */
@route("/items/blob")
@post
op uploadBlob(
  @header contentType: "application/octet-stream",
  @body body: bytes,
): Item;
