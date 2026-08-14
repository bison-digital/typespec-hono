import "@typespec/http";

using Http;

/**
 * **Two interfaces of the same name in different namespaces, which resolve to ONE operation id.**
 *
 * `@typespec/openapi3` derives an operation id from the immediate parent container by default
 * (`operation-id-strategy: parent-container`), so `Query.Standard.primitive` and
 * `Path.Standard.primitive` are both `Standard_primitive`. OpenAPI requires an operation id to be
 * unique and openapi3 raises **nothing**: it writes a document with duplicate ids.
 *
 * Every generated declaration here is keyed on that id -- the `Operations` member, the `...Handler`
 * alias, the handler call -- so before the refusal the emitter wrote each of them twice and the file
 * did not compile. Measured on `@typespec/http-specs`'s `routes`, where six namespaces declare an
 * interface `Standard`: 36 `TS2300: Duplicate identifier` while `tsp compile` reported success.
 *
 * `unique` below is the other half of the assertion: a refusal must exclude only what it names, so an
 * operation whose id does not collide is still served.
 */
@service(#{ title: "Collisions" })
namespace Collisions;

model Thing {
  id: string;
}

namespace Query {
  @route("/query/standard")
  interface Standard {
    @get primitive(@query param?: string): Thing;
  }
}

namespace Path {
  @route("/path/standard")
  interface Standard {
    @get primitive(@path param: string): Thing;
  }
}

@route("/unique")
@get
op unique(): Thing;
