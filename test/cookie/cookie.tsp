import "@typespec/http";

using Http;

/**
 * Cookie parameters, which reached nothing at all before.
 *
 * `@typespec/openapi3` publishes each of these as `in: cookie`, and `@typespec/http` reports them on
 * `operation.parameters.parameters` like any other, discriminated as `type: "cookie"`.
 */
@service(#{ title: "Cookies" })
namespace Cookies;

@route("/session")
interface Sessions {
  /** Required, which is what the document says and what nothing enforced. */
  @get read(@cookie session: string): { @statusCode statusCode: 200; @body body: { saw: string } };

  /** Optional, so the absent case is a legitimate request rather than a refusal. */
  @route("/maybe")
  @get
  maybe(@cookie trace?: string): { @statusCode statusCode: 200; @body body: { saw: string } };

  /** Beside a header and a query parameter, so the groups are kept apart rather than merged. */
  @route("/mixed")
  @get
  mixed(
    @cookie session: string,
    @header("x-request-id") requestId: string,
    @query limit: int32,
  ): { @statusCode statusCode: 200; @body body: { saw: string } };
}
