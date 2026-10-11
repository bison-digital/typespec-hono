import "@typespec/http";

using Http;

/**
 * A body that sends a key a path parameter also has.
 *
 * Merged into one input, the body's value replaced the path's: `POST /accounts/1/entries` with
 * `{ "accountId": 2 }` handed the handler `accountId: 2`, so the entry landed on the account the
 * body chose while any check on the path saw account 1. The body is now named, beside the path.
 */
@service(#{ title: "Collide" })
namespace Collide;

model Entry {
  accountId: int64;
  amountMinor: int64;
}

model Account {
  @visibility(Lifecycle.Read) accountId: int64;
  label: string;
}

@route("/accounts/{accountId}/entries")
@post
op add(@path accountId: int64, @body body: Entry): void;

/** The body's `accountId` is read-only, so the body sent has none, and nothing collides. */
@route("/accounts/{accountId}")
@put
op rename(@path accountId: int64, @body body: Account): void;
