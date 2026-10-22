import "@typespec/http";
using Http;
@service(#{ title: "Voidy" })
namespace Voidy;
@route("/ping") @get @useAuth(NoAuth) op ping(): void;
@route("/pong") @get @useAuth(NoAuth) op pong(): void;
