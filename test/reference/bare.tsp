import "@typespec/http";
using Http;
@service(#{ title: "Bare" })
namespace Bare;
@route("/") @get @useAuth(NoAuth) op root(): { message: string };
@route("/health") @get @useAuth(NoAuth) op health(): { status: string };
