import "@typespec/http";

using Http;

/**
 * The same API as `reference-app.ts`, expressed in TypeSpec.
 *
 * ⚠️ **Written from the reference app, not from what this emitter does with it.** The pair is only
 * evidence if the spec describes the API somebody hand-wrote; a spec reverse-engineered from our own
 * output would make the comparison circular. Every operation, status and constraint here has a
 * counterpart in `reference-app.ts`, and `equivalence.test.ts` is what checks the two behave alike.
 *
 * Deliberately small and deliberately load-bearing: a path parameter with a constraint, a validated
 * JSON body, an array response, and a bodyless `204` — the last being the case that used to vanish
 * from the route table without a word.
 */
@service(#{ title: "Widgets" })
namespace Widgets;

model Widget {
  id: string;

  @minLength(1)
  name: string;

  weight: int32;
}

model CreateWidget {
  @minLength(1)
  name: string;

  weight: int32;
}

@route("/widgets/{id}")
@get
op getWidget(@path @minLength(1) id: string): Widget;

@route("/widgets")
@post
op createWidget(@body body: CreateWidget): {
  @statusCode statusCode: 201;
  @body body: Widget;
};

@route("/widgets")
@get
op listWidgets(): Widget[];

@route("/widgets/{id}")
@delete
op deleteWidget(@path @minLength(1) id: string): NoContentResponse;
