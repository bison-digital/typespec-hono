import "@typespec/http";

using Http;

/**
 * Response headers whose wire names are the names of types the server file may import.
 *
 * The imports were chosen by scanning the rendered result types for those names, so a header keyed
 * `ByteStream` or `StatusCode` imported a type nothing used, and the file failed `noUnusedLocals`.
 */
@service(#{ title: "Header names" })
namespace HeaderNames;

model Thing {
  id: string;
}

@route("/thing")
@get
op readThing(): {
  @header("ByteStream") stream: string;
  @header("StatusCode") code: string;
  @body body: Thing;
};
