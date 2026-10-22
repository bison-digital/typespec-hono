import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

/** Operation ids that are valid ids and not identifiers, and ids that meet once made identifiers. */
@service(#{ title: "Operation ids" })
namespace OperationIds;

@route("/a") @get @operationId("get.widget") op a(): { @statusCode code: 204 };
@route("/b") @get @operationId("get_widget") op b(): { @statusCode code: 204 };
@route("/c") @get @operationId("1st") op c(): { @statusCode code: 204 };
@route("/d") @get @operationId("list*/items") op d(): { @statusCode code: 204 };
@route("/e") @get @operationId("x-y") op e(): { @statusCode code: 204 };
