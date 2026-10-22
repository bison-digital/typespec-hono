import "@typespec/http";

using Http;

/**
 * A multipart upload: a required file part, an optional one, and a repeated one.
 *
 * **The handler boundary again.** `typespec-http-zod@0.18.0` types a `HttpPart<File>` as a file
 * instead of `unknown`, and the interesting question here is not whether it emitted that - the
 * library asserts it - but whether it survives the walk that builds a handler's input type. The
 * open-model fix did not, which is the whole reason this directory exists.
 *
 * `optional` and `multi` are branches in the emitter, and a narrowed part has to survive both
 * wrappers: `.optional()` and `z.array()` are applied to the refined schema and either could hand
 * back the unrefined one.
 */
@service(#{ title: "Upload" })
namespace Upload;

model UploadParts {
  file: HttpPart<File>;
  thumbnail?: HttpPart<File>;
  pages: HttpPart<File>[];
  alt?: HttpPart<string>;
}

@route("/u")
@post
op upload(@header contentType: "multipart/form-data", @multipartBody body: UploadParts): void;
