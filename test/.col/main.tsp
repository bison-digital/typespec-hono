import "@typespec/http";
using Http;
@service(#{ title: "C" })
namespace C;
@route("/x") @post @useAuth(NoAuth) op x(@query q?: string, @body body: Record<string>): void;
