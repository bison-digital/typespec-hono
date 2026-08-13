import "@typespec/http";

using Http;

/**
 * **A service served under a base path, which nothing else in this suite declares.**
 *
 * **Every other fixture here either declares no `@server` or a templated one**, and the corpus is
 * almost entirely `@server("{endpoint}")`, so the static-base-path branch was written and graded by
 * nothing. Dropping it entirely from `src/` left the whole suite green.
 *
 * An OpenAPI path is relative to its server, so this document publishes `/api/v1/things`, and a
 * server that mounted `/things` would disagree with the document generated beside it.
 */
@service(#{ title: "Based" })
@server("/api/v1", "Versioned base path")
namespace Based;

model Thing {
  id: string;
}

@route("/things")
interface Things {
  @get list(): Thing[];
  @get read(@path id: string): Thing;
}
