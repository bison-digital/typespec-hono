import "@typespec/http";

using Http;

/**
 * An OPTIONAL multipart body, the REQUIRED one beside it, and an anonymous parts model.
 *
 * **A body that may be absent cannot be flattened into the input.** A merge has no way to say
 * "these properties are here only sometimes", so an optional body is NAMED. `typespec-http-zod`
 * has published that rule since `0.20.0` and applied it to single bodies only: `requestBodyOf`
 * resolves a body only when `bodyKind === "single"`, so the `optionalBody` disjunct that decides
 * `bodyProperty` was unreachable for a multipart body however the document declared it.
 *
 * The emitted server for `upload` below therefore did not compile: the call site spread a value
 * typed `UploadParts | undefined` into a position requiring the properties.
 *
 * **`required` is the control and it must stay MERGED.** The indexed reason does not apply to a
 * parts model, so a required multipart body flattens as safely as a required single one, and
 * `test/filepart/` compiles a handler that reads `input.file` directly. Only the optional reason
 * applies here; widening to "multipart is always named" would rewrite that directory for no defect.
 *
 * `anonymous` carries an inline parts model, so "the body always has a declared name" is proven
 * rather than assumed.
 */
@service(#{ title: "Optional multipart" })
namespace OptionalMultipart;

model UploadParts {
  file: HttpPart<File>;
  pages: HttpPart<File>[];
}

@route("/optional")
@post
op upload(@header contentType: "multipart/form-data", @multipartBody body?: UploadParts): void;

@route("/required")
@post
op required(@header contentType: "multipart/form-data", @multipartBody body: UploadParts): void;

@route("/anonymous")
@post
op anonymous(
  @header contentType: "multipart/form-data",
  @multipartBody body?: {
    note: HttpPart<string>;
  },
): void;
