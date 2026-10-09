import "@typespec/http";

using Http;

/**
 * Operations sharing a route, told apart only by `accept`, where ONE member of each route answers a
 * model as XML and so raises `unvalidated-response-media-type`.
 *
 * **Verb and path do not identify an operation here**, and this emitter looked operations up by
 * them, so the diagnostic pointed at whichever member the lookup found. The XML member is second
 * on one route and first on the other, so a lookup answering either the first or the last member
 * of a route fails.
 */
@service(#{ title: "Shared" })
namespace Shared;

model Report {
  text: string;
}

@sharedRoute
@route("/report")
@get
op reportAsJson(@header accept: "application/json"): Report;

@sharedRoute
@route("/report")
@get
op reportAsXml(@header accept: "application/xml"): {
  @header contentType: "application/xml";
  @body body: Report;
};

@sharedRoute
@route("/status")
@get
op statusAsXml(@header accept: "application/xml"): {
  @header contentType: "application/xml";
  @body body: Report;
};

@sharedRoute
@route("/status")
@get
op statusAsJson(@header accept: "application/json"): Report;
