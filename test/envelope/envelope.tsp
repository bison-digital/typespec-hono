import "@typespec/http";

using Http;

/**
 * **Every kind of response a handler can return, and how each one is served.**
 *
 * A handler returns `{ status, body, headers }` for any response its document declares, and the
 * generated route serves it with the Hono call for that response. Each operation below is one way a
 * declared response differs from a plain JSON 200: a status chosen from several, a header, a status
 * RANGE, the catch-all, a problem document, text, a model served as XML, raw bytes, a status offering
 * two media types, and no body at all.
 */
@service(#{ title: "Envelope" })
namespace Envelope;

model Item {
  id: string;
  label: string;
}

/** Two success statuses. The handler names the one it means. */
model Created {
  @statusCode statusCode: 200 | 201;
  @body body: Item;
}

@route("/items")
@post
op create(@body body: Item): Created;

/** A response header beside a body. */
model Tagged {
  @statusCode statusCode: 200;
  @header("x-correlation-id") correlationId: string;
  @body body: Item;
}

@route("/items/{id}")
@get
op tagged(@path id: string): Tagged;

/** The control: an ordinary single-status operation. */
@route("/items/plain")
@get
op plain(): Item;

model Problem {
  title: string;
}

/** A failure RANGE, as a problem document, with an optional header. */
@error
model Throttled {
  @minValue(400)
  @maxValue(499)
  @statusCode
  code: int32;

  @header("retry-after") retryAfter?: int32;
  @header contentType: "application/problem+json";
  @body problem: Problem;
}

/** The catch-all. It declares no status, so it is the document's `default`. */
@error
model Unexpected {
  reason: string;
}

@route("/items/{id}/throttle")
@get
op throttle(@path id: string): Item | Throttled | Unexpected;

/** A string under a non-JSON media type: the body is the text, and it is validated. */
@route("/text")
@get
op text(): {
  @header contentType: "text/plain";
  @body body: string;
};

/** A model under a non-JSON media type: the handler supplies the text, served unvalidated. */
@route("/xml")
@get
op xml(): {
  @header contentType: "application/xml";
  @body body: Item;
};

/** Raw bytes, handed to Hono unread. */
@route("/blob")
@get
op blob(): {
  @header contentType: "application/octet-stream";
  @body body: bytes;
};

/** One status offering two media types. The handler names which one it answers with. */
@route("/either")
@get
op either(): {
  @header contentType: "application/json" | "application/xml";
  @body body: Item;
};

/**
 * One status offering an exact type and a range. The handler names a concrete type inside the range,
 * because a range is not a type a response can be sent as.
 */
@route("/pictures/{kind}")
@get
op picture(@path kind: string): {
  @header contentType: "text/plain" | "image/*";
  @body body: bytes;
};

/** Only a range, so there is nothing to switch on: the named type is checked against it. */
@route("/avatars/{kind}")
@get
op avatar(@path kind: string): {
  @header contentType: "image/*";
  @body body: bytes;
};

/** No response body at all. */
@route("/items/{id}")
@delete
op remove(@path id: string): void;
