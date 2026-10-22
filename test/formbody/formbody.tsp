import "@typespec/http";

using Http;

/**
 * A body sent as a URL-encoded form: every field arrives as text, and the document's schema describes
 * the values it spells. `/form` takes only a form; `/either` takes JSON as well, which is read as it is.
 */
@service(#{ title: "FormBody" })
namespace FormBody;

model Plain {
  n?: int32;
  b?: boolean;
  tags?: int32[];
  name?: string;
}

@route("/form")
@post
@useAuth(NoAuth)
op form(@header contentType: "application/x-www-form-urlencoded", @body body: Plain): Plain;

@route("/either")
@post
@useAuth(NoAuth)
op either(
  @header contentType: "application/json" | "application/x-www-form-urlencoded",
  @body body: Plain,
): Plain;
