import "@typespec/http";

using Http;

/**
 * The response ENVELOPE: which status was chosen, and the headers that go with it.
 *
 * **Both are published in the emitted arms and neither could be reached from a handler.**
 *
 * `create` declares two success statuses. `@typespec/openapi3` publishes both; the emitter wrote one
 * arm, so `armFor` could never select the second and a route that answers 201 on create and 200 on
 * update had no way to say so. The only mechanism for a second arm was `statusDiscriminatorOf`,
 * which needs a required literal property on the body - measured across the whole conformance
 * corpus, it fires ZERO times, so the path had never been emitted at all.
 *
 * `tagged` declares a response header beside a body. An arm names the property to read the header
 * value from, and `@header` properties are stripped from the body schema (correctly - they are not
 * body), so the handler's return type did not carry them. Measured on `payload__head`:
 * `Awaitable<Result<void>>` against an arm naming two header properties.
 */
@service(#{ title: "Envelope" })
namespace Envelope;

model Item {
  id: string;
  label: string;
}

/**
 * Two success statuses chosen by the handler.
 *
 * `@statusCode` typed as a union IS the selector: the handler says which one it means by returning
 * that property, so nothing has to be inferred from the body's shape.
 */
model Created {
  @statusCode statusCode: 200 | 201;
  @body body: Item;
}

@route("/items")
@post
op create(@body body: Item): Created;

/** A response header beside a body, so the arm names a property the handler has to be able to set. */
model Tagged {
  @statusCode statusCode: 200;
  @header("x-correlation-id") correlationId: string;
  @body body: Item;
}

@route("/items/{id}")
@get
op tagged(@path id: string): Tagged;

/** The control: an ordinary single-status operation with no envelope at all. */
@route("/items/plain")
@get
op plain(): Item;
