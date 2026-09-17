import "@typespec/http";

using Http;

/**
 * A recursive model, which is what makes an unbounded parse depth reachable.
 *
 * `@typespec/openapi3` publishes this as a `$ref` to itself with no depth keyword, because JSON
 * Schema has none, so the document permits a value of any depth. Ajv 2020-12 on that document agrees:
 * measured VALID at 100, 1000, 1500, 2000 and 3000 levels.
 */
@service(#{ title: "Deep" })
namespace Deep;

model Node {
  name: string;
  child?: Node;
}

@route("/deep")
@post
op deep(@body body: Node): { @statusCode statusCode: 200; @body body: { ok: boolean } };
