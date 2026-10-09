import "@typespec/http";

using Http;

/**
 * Bodies a server hands over unread, because there is nothing to parse.
 *
 * An `Http.File` is its contents, whatever its media type, so a file declared `application/json` is
 * still bytes. A model under `application/xml` has no reader this emitter can derive, so it is the
 * text that arrived. Each used to reach the handler as the wrong thing or as nothing at all.
 */
@service(#{ title: "Raw bodies" })
namespace RawBodies;

model Thing {
  id: string;
}

@route("/files") @post op uploadImage(@bodyRoot file: Http.File<"image/png" | "image/jpeg">): void;

@route("/json-file") @post op uploadJsonFile(@bodyRoot file: Http.File<"application/json">): void;

@route("/xml") @put op putXml(@header contentType: "application/xml", @body body: Thing): void;

@route("/files/latest") @get op downloadImage(): Http.File<"image/png">;
