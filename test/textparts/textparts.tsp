import "@typespec/http";

using Http;

/**
 * Multipart parts read from text, which a client may send with a filename, beside a file and raw
 * bytes, which are left as they arrive. See `textparts.test.ts`.
 */
@service(#{ title: "Text parts" })
namespace TextParts;

model Address {
  city: string;
}

model Form {
  json?: HttpPart<Address>;
  list?: HttpPart<int32[]>;
  flags?: HttpPart<Record<boolean>>;
  nested?: HttpPart<Record<Record<boolean>>>;
  bag?: HttpPart<Record<unknown>>;
  repeatedFlags?: HttpPart<Record<boolean>>[];
  text?: HttpPart<string>;
  number?: HttpPart<int32>;
  either?: HttpPart<string | Address>;
  repeated?: HttpPart<Address>[];
  file?: HttpPart<File>;
  raw?: HttpPart<bytes>;
}

@route("/f")
@post
op f(@header contentType: "multipart/form-data", @multipartBody body: Form): void;
