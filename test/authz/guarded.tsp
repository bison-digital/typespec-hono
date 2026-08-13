import "@typespec/http";

using Http;

/**
 * Scoped and unscoped operations side by side.
 *
 * `@useAuth(OAuth2Auth<...>)` reaches OpenAPI as `security` per operation, so which scopes an
 * operation demands is a contract fact the emitted server must enforce, and for one commit it did
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

/** No `@useAuth`, so nothing to gate. The arm that keeps the rule from applying to everything. */
@useAuth(NoAuth)
@route("/health") op health(): Widget;

/**
 * **A scheme with NO scopes, which carried no gate at all until the requirements were passed
 * through.** `@useAuth(BearerAuth)` publishes `security: [{ "BearerAuth": [] }]`, and a scopes-only
 * gate saw an empty list and emitted nothing, so which scheme the contract names was thrown away for
 * bearer, api-key and basic, which is most services.
 */
@useAuth(BearerAuth)
@route("/widgets/{id}/audit") op auditWidget(@path id: string): Widget;

/**
 * Two schemes, either of which authorises. An OpenAPI `security` array with two entries. A flat set
 * of scopes cannot express the difference between "either" and "both".
 */
@useAuth(Read | BearerAuth)
@route("/widgets/{id}/history") op widgetHistory(@path id: string): Widget;
