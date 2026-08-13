import "@typespec/http";

using Http;

/**
 * **A service whose declared servers disagree about the base path.**
 *
 * There is no prefix that serves both, so this emitter mounts at the root and reports
 * `ambiguous-server-path`. Picking one would serve the wrong URL for the other, and a route mounted
 * under a wrong prefix still matches and still answers, which is worse than one that fails.
 */
@service(#{ title: "Ambiguous" })
@server("/api/v1", "One")
@server("/api/v2", "Another")
namespace Ambiguous;

model Thing {
  id: string;
}

@route("/things")
interface Things {
  @get list(): Thing[];
}
