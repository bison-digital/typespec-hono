import "@typespec/http";

using Http;

/**
 * An open model, nested inside another open model, served as a RESPONSE.
 *
 * **The handler boundary is where a generated shape stops describing a payload and starts obliging
 * the application.** A handler returns a value the codebase already holds, so if the generated
 * return type carries an index signature no plain domain interface can satisfy it, and a consumer
 * ends up spreading every level of the tree to hand back what it already had.
 */
@service(#{ title: "Open" })
namespace Open;

model OpenChild {
  ...Record<unknown>;
  id: string;
}

model OpenParent {
  ...Record<unknown>;
  code: string;
  child: OpenChild;
}

@route("/n")
@get
op nested(): OpenParent;

@route("/b")
@post
op both(@body body: OpenParent): OpenParent;
