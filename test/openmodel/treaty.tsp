import "@typespec/http";

using Http;

/**
 * A parameterless operation beside one that takes a path parameter, plus arrays and an optional.
 *
 * **A parameterless operation used to emit `(ctx)` while every other operation emitted
 * `(ctx, input)`.** A uniform dispatch surface - an RPC entrypoint, a proxy, anything written once
 * against `Operations` - is typed `(ctx, input)`, and TypeScript refuses a function with MORE
 * parameters than the signature it is assigned to. So one parameterless operation made the whole
 * surface unassignable.
 *
 * The arrays and the optional are here for the producer direction: a handler returns what the
 * application already holds, which is commonly an immutable view.
 */
@service(#{ title: "Treaty" })
namespace Treaty;

model Entry {
  id: string;
}

model Page {
  entries: Entry[];
  tags: string[];
  note?: string;
}

@route("/p")
@get
op listPages(): Page;

@route("/p/{id}")
@get
op getPage(@path id: string): Page;
