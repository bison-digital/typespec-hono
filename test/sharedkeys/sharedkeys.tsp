import "@typespec/http";

using Http;

/**
 * **Two inputs of one operation that a handler would be handed under one key.** The pairs of
 * typespec-http-graphql's report of 2026-10-16, a same-location pair whose declarations agree, and a
 * control.
 */
@service(#{ title: "Shared keys" })
namespace SharedKeys;

model Thing {
  id: string;
}

@route("/header-query")
@get
op headerQuery(@header("x") a: string, @query("x") b: int32): Thing;

@route("/query-query")
@get
op queryQuery(@query("x") a: string, @query("x") b: int32): Thing;

/** Both declarations agree, so the one value they share still has a form that satisfies them. */
@route("/query-query-agreeing")
@get
op queryQueryAgreeing(@query("y") a: string, @query("y") b: string): Thing;

@route("/path-header/{id}")
@get
op pathHeader(@path id: string, @header("id") header: string): Thing;

@route("/cookie-query")
@get
op cookieQuery(@cookie("session") cookie: string, @query("session") query: string): Thing;

/** A list body is handed over under its property's name, `body`, which the query parameter takes too. */
@route("/query-body")
@post
op queryBody(@query("body") q: string, @bodyRoot body: Thing[]): Thing;

@route("/control")
@get
op control(@header("x") a: string, @query("y") b: int32): Thing;
