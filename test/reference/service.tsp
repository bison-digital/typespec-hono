import "@typespec/http";

using Http;

/**
 * **The reference service: the fixture both packages are judged against.**
 *
 * It belongs to no application and models no real domain, deliberately. Every construct here is one
 * that has broken an emitter: not a tour of the language, a list of things that went wrong.
 *
 * **It has to be readable as a whole.** A fixture nobody can hold in their head stops being
 * evidence and becomes a thing tests happen to run against. Each section says which failure it
 * exists for, so a construct cannot be deleted without somebody noticing what goes uncovered.
 *
 * Three questions are asked of it:
 *
 * 1. **Zod alone**. Do the emitted validators say exactly what `@typespec/openapi3` publishes?
 * 2. **Hono alone**. Is the emitted server what a Hono author would have written by hand?
 * 3. **Together**. Can an application be built on both, and does it answer real requests correctly?
 */
@service(#{ title: "Reference" })
namespace Reference;

// --- Vocabularies --------------------------------------------------------------------------------

/** A closed string set. Emitted as a tuple so a second package can branch on the same values. */
enum Colour {
  red,
  green,
  /** A member whose wire value differs from its name. The two must not be confused. */
  deepBlue: "deep-blue",
}

enum Size {
  small,
  large,
}

// --- Constrained scalars -------------------------------------------------------------------------

/**
 * **Constraints are read from the scalar a property NAMES**, not from the primitive it resolves
 * to. A walk that resolves to `string` first drops the pattern on every use.
 *
 * The pattern is anchored **in the spec**. JSON Schema's `pattern` is explicitly not implicitly
 * anchored, so an emitter adding `^`/`$` itself publishes one expression and enforces another, and
 * `^` binds looser than `|`, so it changes the meaning of any top-level alternation.
 */
@pattern("^\\S(?:[\\s\\S]*\\S)?$")
scalar Trimmed extends string;

@pattern("^\\d{4}-\\d{2}-\\d{2}$")
scalar IsoDate extends string;

// --- Shapes --------------------------------------------------------------------------------------

/** Closed: every property declared, nothing else permitted. */
model Widget {
  id: string;

  @minLength(1)
  @maxLength(120)
  name: Trimmed;

  @minValue(0)
  weight: int32;

  colour: Colour;

  /** Optional AND nullable are different facts, and an emitter can confuse them. */
  retiredOn?: IsoDate | null;

  tags: string[];
}

/**
 * Declared properties **and** a spread indexer: "these fields, plus anything else".
 *
 * Reading the indexer first emits a dictionary, which accepts an object and then **strips every
 * declared field**: the pinned properties silently stop being checked while every test that only
 * asserts `success` stays green.
 */
model OpenWidget {
  id: string;
  ...Record<unknown>;
}

/** A TYPED catchall, where a permissive reading would throw the value type away. */
model TypedCatchall {
  id: string;
  ...Record<string>;
}

/** A dictionary, which is a different thing from an object with no properties. */
model Attributes is Record<string | float64 | boolean>;

/**
 * A closed key SET, all optional.
 *
 * TypeSpec has no key-constrained `Record` and `@typespec/openapi3` never emits `propertyNames`,
 * so naming the properties is the only way the document can state which keys are permitted. Anything
 * else means a runtime rejecting keys the contract allows.
 */
model KnownFlags {
  isDraft?: boolean;
  isArchived?: boolean;
  revision?: int32;
}

/** Recursive. Emitting the reference eagerly reads a `const` inside its own initialiser. */
model Node {
  label: string;
  children?: Node[];
}

// --- Polymorphism --------------------------------------------------------------------------------

/**
 * A cross-field rule as polymorphism, the standard replacement for a hand-written predicate.
 *
 * The discriminator is declared **on each variant**. Left only on the base, `@typespec/openapi3`
 * omits it from the variant schema, which OpenAPI 3.1 forbids for a discriminator.
 *
 * The base carries a CONSTRAINT reachable from nowhere else. A discriminated base is compared as
 * a choice, so its own properties reach a differential only through each variant's `allOf`, a
 * comparison that skips inherited properties loses every constraint here and still looks alive.
 */
@discriminator("kind")
model Shape {
  kind: string;

  @minLength(1)
  label: Trimmed;
}

model Circle extends Shape {
  kind: "circle";
  radius: float64;
}

model Square extends Shape {
  kind: "square";
  side: float64;
}

// --- Failures ------------------------------------------------------------------------------------

/** A specific status, with a body of its own. */
@error
model NotFound {
  @statusCode statusCode: 404;
  code: string;
}

/**
 * A status RANGE. `HttpStatusCodesEntry` is `HttpStatusCodeRange | number | "*"`, and an emitter
 * handling only the last two emits nothing at all for this: a whole class of failures with no
 * validator, not refused and not warned about.
 *
 * It covers the bucket exactly; a partial range is unrepresentable in OpenAPI and must be refused.
 */
@error
model Throttled {
  @minValue(400)
  @maxValue(499)
  @statusCode
  statusCode: int32;

  retryAfter: int32;
}

/** No `@statusCode`. This is how TypeSpec spells the document's `default` response. */
@error
model Unexpected {
  reason: string;
}

// --- Operations ----------------------------------------------------------------------------------

/** Path, query and header, each with a WIRE name that differs from its property name. */
@route("/widgets/{widget-id}")
@get
op readWidget(
  @path("widget-id") widgetId: string,

  @query("$select") select?: string,

  @header("x-request-id") requestId: string,
): Widget | NotFound;

/**
 * A list flattened into ONE query value. `?tags=a,b,c` arrives as a single string, so a validator
 * expecting an array refuses every conformant caller, and the document says `array` on both sides,
 * so no document comparison can see it. Only a request can.
 */
@route("/widgets")
@get
op listWidgets(
  @query(#{ explode: false })
  tags?: string[],

  @query size?: Size,
): Widget[];

/** A request body, and a 201 that is not the default success status. */
@route("/widgets")
@post
op createWidget(@body body: Widget): {
  @statusCode statusCode: 201;
  @body body: Widget;
};

/** No response body at all. Requiring one silently drops the whole operation. */
@route("/widgets/{widget-id}")
@delete
op deleteWidget(@path("widget-id") widgetId: string): void;

/** Three failure arms that OVERLAP. `404`, `4XX` and `default` all describe a 404. */
@route("/widgets/{widget-id}/flags")
@put
op setFlags(@path("widget-id") widgetId: string, @body body: KnownFlags):
  | Widget
  | NotFound
  | Throttled
  | Unexpected;

/** Polymorphic request and response. */
@route("/shapes")
@post
op addShape(@body body: Shape): Shape;

/** Recursive, dictionary and open shapes on one route. */
@route("/trees")
@post
op addTree(@body body: Node): {
  node: Node;
  attributes: Attributes;
  open: OpenWidget;
  typed: TypedCatchall;
};

/**
 * Content negotiation: TWO operations, ONE route, chosen by `Accept`.
 *
 * Registering both means the router matches in declaration order and the second is dead code that
 * looks mounted. An unacceptable `Accept` is a 406, never a 400 from validating it as a literal.
 */
@route("/report")
namespace Report {
  @sharedRoute
  @get
  op asJson(@header accept: "application/json"): Widget;

  @sharedRoute
  @get
  op asText(@header accept: "text/plain"): {
    @header contentType: "text/plain";
    @body body: string;
  };
}

/** No caller is established. `@useAuth(NoAuth)` reaches OpenAPI as `security: []`. */
@useAuth(NoAuth)
@route("/health")
@get
op health(): { status: string };

/**
 * **A `HEAD` operation, which some routers cannot serve at all.**
 *
 * Validators for it are ordinary (a path parameter and no body) and this package emits them like
 * any other. Whether it can be MOUNTED is a different question, answered by whichever server emitter
 * a consumer uses, and at least one answers "no": Hono rewrites every HEAD request to GET before
 * matching, so a route registered under HEAD is never reached.
 *
 * It stays here precisely because the two halves must answer differently. A construct that both
 * packages treat identically cannot show that the split is real.
 */
@route("/widgets/{widget-id}")
@head
op widgetExists(@path("widget-id") widgetId: string): void;
