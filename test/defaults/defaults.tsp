import "@typespec/http";

using Http;

/**
 * A response model with a defaulted property.
 *
 * The server checks a result against the arm's schema before it serves it, and `.default(0)` fills
 * an absent `count` - so a handler that leaves it out is answered with `count: 0`, which the document
 * permits. The result type was written from the schema's OUTPUT, where `count` is required, so that
 * handler did not compile, and neither did one returning a value typed by the contract.
 */
@service(#{ title: "Defaults" })
namespace Defaults;

model Row {
  id: string;
  count?: int32 = 0;
}

@route("/rows/{id}") @get op readRow(@path id: string): Row;
