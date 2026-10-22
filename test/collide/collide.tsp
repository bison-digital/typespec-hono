import "@typespec/http";

using Http;

/**
 * A body that sends a key a path parameter also has.
 *
 * Merged into one input, the body's value replaced the path's: `POST /shelves/1/books` with
 * `{ "shelfId": 2 }` handed the handler `shelfId: 2`, so the book landed on the shelf the body chose
 * while any check on the path saw shelf 1. The body is now named, beside the path.
 */
@service(#{ title: "Collide" })
namespace Collide;

model Book {
  shelfId: int64;
  title: string;
}

model Shelf {
  @visibility(Lifecycle.Read) shelfId: int64;
  label: string;
}

@route("/shelves/{shelfId}/books")
@post
op add(@path shelfId: int64, @body body: Book): void;

/**
 * The body's `shelfId` is read-only: openapi3 shares the canonical `Shelf` into the request,
 * `shelfId` still required under OAS 3.1's reading, so the body sends one and it is named too.
 */
@route("/shelves/{shelfId}")
@put
op rename(@path shelfId: int64, @body body: Shelf): void;
