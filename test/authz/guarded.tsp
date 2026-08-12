import "@typespec/http";

using Http;

/**
 * Scoped and unscoped operations side by side.
 *
 * `@useAuth(OAuth2Auth<…>)` reaches OpenAPI as `security` per operation, so which scopes an
 * operation demands is a contract fact the emitted server must enforce — and for one commit it did
 * not: the generated app carried zero references to scopes while the document published eleven.
 */
@service(#{ title: "authz" })
namespace Authz;

alias Read = OAuth2Auth<[
  {
    type: OAuth2FlowType.clientCredentials,
    tokenUrl: "https://example.test/token",
    scopes: ["widgets:read"],
  }
]>;

model Widget {
  id: string;
}

@useAuth(Read)
@route("/widgets") op listWidgets(): Widget[];

/** Scoped AND validated, so the ordering assertion has both to order. */
@useAuth(Read)
@route("/widgets/{id}") op getWidget(@path id: string): Widget;

/** No `@useAuth`, so nothing to gate — the arm that keeps the rule from applying to everything. */
@useAuth(NoAuth)
@route("/health") op health(): Widget;
