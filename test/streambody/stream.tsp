import "@typespec/http";

using Http;

/**
 * A streamed upload, and a webhook whose raw body is JSON.
 *
 * **The two are different requirements that one reader used to conflate.** An upload declares
 * `application/octet-stream`, may be 100 MB, and must never materialise in the isolate - a Worker
 * gets 128 MB. A webhook signature covers exactly the characters that arrived, so that body is read
 * as text on purpose and stays that way.
 *
 * The document publishes only `contentMediaType` for the upload, so nothing about it is validated;
 * reading it produced a value nothing checked and made the only useful thing - piping it onward -
 * impossible.
 */
@service(#{ title: "Stream" })
namespace Stream;

@route("/uploads/{key}")
@put
op upload(
  @path key: string,
  @header contentType: "application/octet-stream",
  @header contentLength: int64,
  @body body: bytes,
): void;

@route("/hooks/inbound")
@post
op hook(@header contentType: "application/json", @body body: bytes): void;
