import "@typespec/http";

using Http;

/**
 * **The wire depth fixture — breadth of TRANSPORT ENCODINGS, not breadth of API.**
 *
 * ⚠️ **This exists because HTTP carries text and the document describes values, and nothing in this
 * package's fixtures made the two disagree.** Every path and query parameter in `service.tsp` is a
 * `string`, so the only suite that makes real requests never once sent a value that had to be decoded
 * — and the corpus, which emits 29 numeric query and header parameters, requests none of them. Two
 * live defects sat in that gap and both refused every conformant caller:
 *
 * - `z.number().int()` met `"1"` from `c.req.param()` and answered **400**. Measured against a
 *   Petstore server under `wrangler dev`: `GET /pet/1` and `GET /store/order/1` both 400 while
 *   `GET /user/zach` answered 200.
 * - `z.literal("multipart/form-data")` met `multipart/form-data; boundary=…` and answered **400** —
 *   and RFC 2046 §5.1.1 makes that boundary mandatory, so **every** syntactically valid multipart
 *   request was refused. 78 `content-type` validators across the corpus were bare literals.
 *
 * Same shape as `constraints.tsp` and for the same reason: the corpus tests protocol behaviour, so a
 * keyword-by-keyword fixture is what makes an arm non-vacuous. **Every parameter form that needs
 * decoding appears exactly once, in the location it is legal in.** The service around them is the
 * smallest thing that makes them reachable.
 *
 * ⚠️ **The `@header contentType` literals matter as much as the numbers.** They are the only place a
 * media type reaches a validator, and a bare literal there enforces "no parameters" — which the
 * document does not say, and which the wire routinely violates with `; charset=utf-8`.
 */
@service(#{ title: "Wire" })
namespace Wire;

// ⚠️ A LOCAL fixture, not the vendored `service.tsp`. It is deliberately NOT digest-shared with the
// library's copy: each package grades its own emitted artefacts, and coupling two fixtures that serve
// different oracles is how a change in one repository breaks the other for no reason.

model Item {
  id: string;
  label: string;
}

// ─── Numeric and boolean parameters, in every location that carries text ─────────────────────────

@route("/items/{itemId}")
@get
op readItem(
  /** A numeric PATH parameter — `c.req.param()` hands this over as a string, always. */
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

// ─── A collection whose ELEMENTS need decoding after the split ───────────────────────────────────

@route("/items")
@get
op listItems(
  /** `?ids=1,2,3` — one string, split into three, each of which is still text. */
  @query(#{ explode: false })
  ids?: int32[],

  /** The same shape carrying booleans, so the element decoder is exercised on both. */
  @query(#{ explode: false })
  flags?: boolean[],
): Item[];

// ─── Media types, where the document states a type and the wire adds parameters ──────────────────

@route("/items/json")
@post
op createFromJson(
  /** A caller sending `application/json; charset=utf-8` is conformant and must not be refused. */
  @header contentType: "application/json",

  @body body: Item,
): Item;

/**
 * ⚠️ **Several accepted media types become an ENUM, not a literal, and that form is what a real
 * document produces.** The whole conformance corpus emits single literals only, so a decoder handling
 * `z.literal` alone looked complete against it — while the Swagger Petstore's `addPet` accepts three
 * and went on refusing `application/json; charset=utf-8`.
 */
@route("/items/any")
@post
op createFromAny(
  @header contentType: "application/json" | "application/xml",
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
   * ⚠️ **The boundary parameter is MANDATORY here**, so a literal that refuses parameters refuses
   * every request this operation can possibly receive.
   */
  @header contentType: "multipart/form-data",

  @multipartBody body: UploadParts,
): Item;
