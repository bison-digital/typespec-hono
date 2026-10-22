import "@typespec/http";

using Http;

/**
 * **A body declared `void` is no body, so it is served as no media type.** `void` is TypeSpec's
 * "nothing here", and openapi3 publishes no `content` for it. A `never` body is refused; see
 * `typespec-http-zod`'s `test/neverbody`.
 */
@service(#{ title: "No body" })
namespace NoBody;

model Thing {
  id: string;
}

@error
model VoidConflict {
  @statusCode _: 409;
  @body body: void;
}

@route("/responses")
@get
op responses(): Thing | VoidConflict;

@route("/void")
@post
op voidRequest(@body body: void): Thing;
