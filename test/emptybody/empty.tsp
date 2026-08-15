import "@typespec/http";

using Http;

/**
 * An empty request model, and an optional body.
 *
 * **Zod 4 infers `Record<string, never>` for `z.object({})`**, not `{}`. Intersected with the path
 * parameters that is `{ id: string } & Record<string, never>` - `id` becomes `string & never`, so
 * the input type is uninhabitable and the generated call site fails `tsc` inside `app.gen.ts`
 * itself. The emitted server does not compile.
 *
 * The optional body is the second finding: the document publishes `requestBody.required: false`,
 * so a request with no body at all is one the contract permits.
 */
@service(#{ title: "Empty" })
namespace Empty;

model Nothing {}

@route("/things/{id}")
@post
op poke(@path id: string, @body body?: Nothing): void;

model Payload {
  note: string;
}

@route("/things/{id}/optional")
@post
op optional(@path id: string, @body body?: Payload): void;
