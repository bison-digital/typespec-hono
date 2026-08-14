import "@typespec/http";
using Http;
@service(#{ title: "F" })
namespace F;
model Thing {
  when: utcDateTime;
  link: url;
  plain: string;
  @format("uuid") id: string;
}
@route("/t") @post @useAuth(NoAuth) op t(@body body: Thing): Thing;
