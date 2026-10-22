import "@typespec/http";

using Http;

/**
 * Bodies a server hands over unread, because there is nothing to parse.
 *
 * An `Http.File` is its contents, whatever its media type, so a file declared `application/json` is
 * still bytes. A model under `application/xml` has no reader this emitter can derive, so it is the
 * text that arrived; under `application/octet-stream` it is the bytes, which text cannot carry. Each
 * used to reach the handler as the wrong thing or as nothing at all.
 */
@service(#{ title: "Raw bodies" })
namespace RawBodies;

model Thing {
  id: string;
}

@route("/files") @post op uploadImage(@bodyRoot file: Http.File<"image/png" | "image/jpeg">): void;

@route("/json-file") @post op uploadJsonFile(@bodyRoot file: Http.File<"application/json">): void;

@route("/xml") @put op putXml(@header contentType: "application/xml", @body body: Thing): void;

/** The `+xml` suffix is XML too (RFC 7303), so this is text as well. */
@route("/atom") @put op putAtom(@header contentType: "application/atom+xml", @body body: Thing): void;

/** A model under a media type that is not text: decoded as text, these bytes were lost. */
@route("/blob") @put op putBlob(@header contentType: "application/octet-stream", @body body: Thing): void;

@route("/blob/latest") @get op getBlob(): {
  @header contentType: "application/octet-stream";
  @body body: Thing;
};

@route("/files/latest") @get op downloadImage(): Http.File<"image/png">;

/** A file whose media type is JSON: served as its bytes, under that type, like any other file. */
@route("/json-file/latest") @get op downloadJsonFile(): Http.File<"application/json">;
