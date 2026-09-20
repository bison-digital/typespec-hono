import "@typespec/http";

using Http;

/**
 * A spec whose request bodies declare a media RANGE rather than a concrete type.
 *
 * `@typespec/http` reports a bare `string`-typed `contentType` as the wildcard range, and an author
 * may write a subtype wildcard outright. Both reach the emitter as the range text, and a server that
 * compares that text to a caller's `Content-Type` refuses every real request: no client sends the
 * range itself.
 */
@service(#{ title: "MediaRange" })
namespace MediaRange;

@route("/range")
@useAuth(NoAuth)
interface Range {
  /** A bare `string` contentType. The document publishes the wildcard range. */
  @route("/wild")
  @post
  wild(@header contentType: string, @body body: string): {
    @statusCode statusCode: 200;
    @body body: { saw: string };
  };

  /** A subtype wildcard, written by the author. */
  @route("/text")
  @post
  textRange(@header contentType: "text/*", @body body: string): {
    @statusCode statusCode: 200;
    @body body: { saw: string };
  };

  /**
   * An OPTIONAL contentType, which is where an absent header reaches the body matcher at all.
   * `copal-gateway/spec/file.tsp:34` declares exactly this beside its wildcard upload. With a
   * required header the validator refuses a headerless request first, so the matcher's own
   * empty-string guard is only reachable through this shape.
   */
  @route("/optional")
  @post
  optional(@header contentType?: string, @body body: string): {
    @statusCode statusCode: 200;
    @body body: { saw: string };
  };

  /** The control: a concrete media type, which must still admit only itself. */
  @route("/plain")
  @post
  plain(@header contentType: "text/plain", @body body: string): {
    @statusCode statusCode: 200;
    @body body: { saw: string };
  };
}
