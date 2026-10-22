import "@typespec/http";
using Http;

/**
 * A server-assigned read-only `id` in a create body, and nested in its items - the commonest CRUD
 * shape there is. See `readonly.test.ts`.
 */
@service(#{ title: "Read-only" })
namespace ReadOnly;

model Item {
  @visibility(Lifecycle.Read) id: string;
  label: string;
}

model Widget {
  @visibility(Lifecycle.Read) id: string;
  name: string;
  items: Item[];
}

@route("/widgets") @post op create(@body widget: Widget): {
  @statusCode _: 201;
  @body body: Widget;
};
