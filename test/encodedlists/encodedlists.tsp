import "@typespec/http";

using Http;

/**
 * **An `@encode`d list parameter, in each place an encoding can sit.** The five operations of
 * typespec-http-graphql's report of 2026-10-16.
 *
 * - Q and S: an array encoding on a QUERY parameter is a style, so the declared list stays and the
 *   value is split back into it. Q's items are numbers, so each one is decoded too.
 * - P and H: on a path or a header the same encoding makes the wire type the type it states, a
 *   string, and the value is that string, unsplit.
 * - C: any other `@encode` makes the wire type the type it states, on a query parameter as well.
 */
@service(#{ title: "Enc" })
namespace Enc;

model Thing {
  id: string;
}

@route("/q")
interface Q {
  @get read(@query @encode(ArrayEncoding.pipeDelimited) ids: int32[]): Thing;
}

@route("/p/{ids}")
interface P {
  @get read(@path @encode(ArrayEncoding.commaDelimited) ids: string[]): Thing;
}

@route("/h")
interface H {
  @get read(@header("x-tags") @encode(ArrayEncoding.commaDelimited) tags: string[]): Thing;
}

@route("/c")
interface C {
  @get read(@query @encode("x-custom", string) tags: string[]): Thing;
}

@route("/s")
interface S {
  @get read(@query @encode(ArrayEncoding.commaDelimited) tags: string[]): Thing;
}

/**
 * M: the same rule inside a form-exploded query model. `@encode(string)` makes `count` a string on
 * the wire, and `flag` beside it is a boolean decoded from its text.
 */
model Filter {
  @encode(string) count: int32;
  flag: boolean;
}

@route("/m")
interface M {
  @get read(@query(#{ explode: true }) filter: Filter): Thing;
}
