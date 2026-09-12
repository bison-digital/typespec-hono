import "@typespec/http";

using Http;

/**
 * A body that cannot be read at all, in every position the emitter mounts one.
 *
 * **A rejection this server produces has to be a response its own document describes.** An API whose
 * document declares a JSON error envelope answering `text/plain` is answering a shape its own
 * contract forbids, and the app has no way to intervene because the throw happens before its code
 * runs.
 *
 * Measured against hono 4.13.1, whose validator throws an `HTTPException` carrying "Malformed JSON
 * in request body" when the content type matches its JSON pattern and the body will not parse, and
 * another carrying "Malformed FormData request." when the form reader fails - both raised BEFORE any
 * hook is called.
 *
 * The three positions differ in which middleware mounts the body, which is why one arm per position
 * rather than one for the shape:
 *
 * - a REQUIRED single-media-type body was mounted by `zValidator`, whose throw escapes the envelope;
 * - an OPTIONAL body is mounted by this package's own `optionalBody`, which caught the JSON case and
 *   not the form one;
 * - a DISPATCHED body - several media types needing different parsers - is mounted by
 *   `byContentType`, which had the same gap in the same helper.
 */
@service(#{ title: "Malformed" })
namespace Malformed;

model Payload {
  note: string;
}

/** `@typespec/http` requires a multipart payload to be spelled with parts, so it is. */
model Parts {
  note: HttpPart<string>;
}

/** Required, single media type: the position the changelog recorded as a known limit. */
@route("/required")
@post
op required(@body body: Payload): void;

/** Optional, so it is mounted by `optionalBody` rather than by `zValidator`. */
@route("/optional")
@post
op optional(@body body?: Payload): void;

/**
 * A multipart body, so the `"form"` reader is exercised rather than the JSON one.
 *
 * **Multipart rather than urlencoded, and that took measuring.** Only multipart can fail to parse:
 * measured on this runtime, `formData()` throws for every malformed multipart payload tried and for
 * no urlencoded one - `%%%` parses to a key with an empty value. A urlencoded fixture would have
 * looked like it covered the form branch while never reaching the failure at all.
 */
@route("/form")
@post
op form(
  @header contentType: "multipart/form-data",
  @multipartBody body: Parts,
): void;

/**
 * **The only spec shape that reaches the optional path WITH the form reader, and it was absent.**
 *
 * This operation used to be a docblock explaining why it could not exist: the emitted server for an
 * optional multipart body did not compile, so a fixture carrying one would have failed the compile
 * arm rather than covered anything. `typespec-http-zod` named such a body instead of merging it,
 * and the shape became expressible, so the omission is gone and the coverage it cost is back.
 *
 * An oracle narrowed to accommodate a defect outlives the defect unless closing it is part of the
 * fix. This is that part.
 */
@route("/optional-form")
@post
op optionalForm(
  @header contentType: "multipart/form-data",
  @multipartBody body?: Parts,
): void;
