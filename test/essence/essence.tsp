import "@typespec/http";

using Http;

/**
 * A JSON media type declared with a parameter, in every place a server compares one: the request
 * body's branch, the `Content-Type` it sends back, and the negotiation that chooses between two
 * operations on one route. Each compared the declared text whole, and a request's media type is
 * compared by its essence, so the declared type matched nothing.
 */
@service(#{ title: "Essence" })
namespace Essence;

model Thing {
  id: string;
}

@route("/charset")
@post
op withCharset(@header contentType: "application/json; charset=utf-8", @body body: Thing): {
  @header contentType: "application/json; charset=utf-8";
  @body body: Thing;
};

@sharedRoute
@route("/negotiated")
@get
op asJson(@header accept: "application/json; charset=utf-8"): {
  @header contentType: "application/json; charset=utf-8";
  @body body: Thing;
};

@sharedRoute
@route("/negotiated")
@get
op asText(@header accept: "text/plain"): {
  @header contentType: "text/plain";
  @body body: string;
};
