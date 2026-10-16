import "@typespec/http";

using Http;

/**
 * **A body declared `void` or `never` is no body, so it is served as no media type.**
 *
 * `void` is TypeSpec's "nothing here", and openapi3 publishes no `content` for it. `never` is the type
 * with no values: openapi3 omits a `never` PROPERTY from every schema, while its body paths test only
 * for `void`, so a `never` body is published as `schema: {}` - any value - under `application/json`.
 * See `nobody.test.ts`, which pins that divergence.
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

@error
model NeverGone {
  @statusCode _: 410;
  @body body: never;
}

@route("/responses")
@get
op responses(): Thing | VoidConflict | NeverGone;

@route("/void")
@post
op voidRequest(@body body: void): Thing;

@route("/never")
@post
op neverRequest(@body body: never): Thing;
