import "@typespec/http";

using Http;

/**
 * **`@encode` on every kind of declared type the document can state, in every location.**
 *
 * `@typespec/openapi3`'s `applyEncoding` keeps the schema the property publishes - a `$ref`, an
 * `enum`, a `pattern`, the `anyOf` of a nullable - replaces its `type` with the encoded scalar's,
 * drops `items` unless that is an array, and sets `format`. So the value has to satisfy both the
 * declared type and the encoded scalar. `typespec-http-zod`'s `test/encodingmatrix` grades each row
 * against the document; `encodedtypes.test.ts` sends them through the generated routes, beside a
 * discriminated base whose subtype declares no discriminator.
 */
@service(#{ title: "Encoding matrix" })
namespace EncodingMatrix;

@pattern("^[a-z]+$")
scalar Word extends string;

enum Color {
  red,
  blue,
}

union Pick {
  "a",
  "b",
}

model Body {
  @encode(string) int: int32;
  @encode("x", string) word: Word;
  @encode("x", string) color: Color;
  @encode("x", string) pick: Pick;
  @encode("x", string) inlineUnion: "a" | "b";
  @encode(ArrayEncoding.commaDelimited) list: int32[];
  @encode("x", string) rec: Record<int32>;
  @encode(string) nullableInt: int32 | null;
  @encode("x", string) nullableColor: Color | null;
  @encode(DateTimeKnownEncoding.unixTimestamp, int32) at: utcDateTime;
  @encode("x", string) mixed: string | int32;
}

@route("/body")
@post
op body(@body body: Body): void;

@route("/query")
@get
op query(
  @query @encode(string) int: int32,
  @query @encode("x", string) word: Word,
  @query @encode("x", string) color: Color,
  @query @encode("x", string) pick: Pick,
  @query @encode("x", string) inlineUnion: "a" | "b",
  @query @encode("x", string) rec: Record<int32>,
  @query @encode(DateTimeKnownEncoding.unixTimestamp, int32) at: utcDateTime,
  @query @encode("x", string) mixed: string | int32,
): void;

@route("/header")
@get
op header(
  @header("x-int") @encode(string) int: int32,
  @header("x-word") @encode("x", string) word: Word,
  @header("x-color") @encode("x", string) color: Color,
  @header("x-list") @encode(ArrayEncoding.commaDelimited) list: int32[],
): void;

@route("/path/{color}/{word}")
@get
op path(@path @encode("x", string) color: Color, @path @encode("x", string) word: Word): void;

@route("/cookie")
@get
op cookie(@cookie("c") @encode("x", string) color: Color): void;

/** A discriminated base whose subtype declares no discriminator, and whose subtype's subtype does. */
@discriminator("kind")
model Animal {
  kind: string;
  name: string;
}

model Mammal extends Animal {
  legs: int32;
}

model Cat extends Mammal {
  kind: "cat";
  whiskers: int32;
}

model Bird extends Animal {
  kind: "bird";
  wingspan: int32;
}

@route("/animal")
@post
op animal(@body body: Animal): Animal;

/** A subtype redeclaring a base property without the base's constraint, which still applies. */
@discriminator("kind")
model Pet {
  kind: string;
  @maxLength(3) name: string;
}

model Dog extends Pet {
  kind: "dog";
  name: string;
}

@route("/pet")
@post
op pet(@body body: Pet): void;
