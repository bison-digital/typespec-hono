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
