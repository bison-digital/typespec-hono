import "@typespec/http";

using Http;

/** See the docblock on `inputTypeOf`: an indexed body is named rather than spread. */
@service(#{ title: "Rec" })
namespace Rec;

@route("/x")
@post
@useAuth(NoAuth)
op x(@query q?: string, @body body: Record<string>): void;

model Thing {
  id: string;
}

/** The control: an ordinary model body is still spread. */
@route("/y")
@post
@useAuth(NoAuth)
op y(@query q?: string, @body body: Thing): void;

/**
 * **The FORM case, which the first version of this fixture missed entirely.**
 *
 * A form body validates under the `"form"` target, not `"json"`, so a filter keyed on the JSON
 * target skipped it and the intersection was emitted anyway. Measured on a clean install of the
 * published package: this exact operation still failed with `TS2345`.
 */
@route("/z")
@post
@useAuth(NoAuth)
op z(
  @header contentType: "application/x-www-form-urlencoded",
  @query q?: string,
  @body body: Record<string>,
): void;
