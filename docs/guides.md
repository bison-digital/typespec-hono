# Guides

## Responses, successes and failures alike

A handler returns `{ status, body, headers }` for any response its operation declares. The type of
that result is the union of the declared responses, one member per status:

```tsp
@error
model NotFound {
  @statusCode statusCode: 404;
  code: string;
}

@error
model Throttled {
  @minValue(400)
  @maxValue(499)
  @statusCode
  statusCode: int32;

  @header("retry-after") retryAfter?: int32;
  reason: string;
}

@error
model Unexpected {
  message: string;
}

op setFlags(@path id: string, @body flags: Flags): Widget | NotFound | Throttled | Unexpected;
```

```ts
const setFlags: SetFlagsHandler<Caller> = async (ctx, input) => {
	const widget = await widgets.find(input.id);
	if (widget === undefined) return { status: 404, body: { code: "no-such-widget" } };
	if (await limiter.exceeded(ctx)) {
		return { status: 429, body: { reason: "slow down" }, headers: { "retry-after": 30 } };
	}
	return { status: 200, body: await widgets.setFlags(widget, input) };
};
```

- **An exact status** is its own member: `404` above.
- **A range** accepts any status in it that is not declared more precisely: `Throttled` answers any
  4xx except `404`.
- **The catch-all** (`@error` with no `@statusCode`) accepts any status not otherwise declared.
- **Headers** are keyed by the wire name the document publishes. A required header must be supplied;
  an optional one may be left out.
- **A status offering several media types** takes a `contentType` naming the one answered with.
  Where it offers a range such as `image/*`, the handler names a concrete type inside it, typed
  `` `image/${string}` ``: a range is not a type a response can be sent as.

A status the operation does not declare, a body belonging to another status, a missing required
header or a body on a response that has none does not compile.

**Declared response headers are checked the same way.** A header whose value the document forbids -
a `@pattern` it does not match, a bound it exceeds - is not served: the route throws
`ResponseContractError` with `part: "headers"`, and nothing reaches the wire. Optional headers the
handler did not supply are absent rather than checked, and headers the emitter sets itself, such as
`Content-Type`, are not part of the document's constraint and pass through untouched.

**What is served is the body parsed against the schema the document publishes for that status.** A
schema that strips undeclared keys strips them from the response too, so an internal field does not
reach a caller by accident. A body the schema refuses is not served: the route throws
`ResponseContractError`, carrying the operation id, the status and Zod's issues, and your `app.onError`
decides what that answers with. A status outside the declared set - reachable only through a cast, or
untyped data from a service binding - throws `UndeclaredStatusError`:

```ts
import { ResponseContractError, UndeclaredStatusError } from "./generated/runtime.gen.js";

app.onError((error, c) => {
	if (error instanceof ResponseContractError || error instanceof UndeclaredStatusError) {
		reportDrift(error);
		return c.json({ error: "internal" }, 500);
	}
	return c.json({ error: "internal" }, 500);
});
```

Write handlers with `satisfies Operations<Caller>`, or annotate each with its `XHandler<Caller>`
alias. A result written into a plain object literal widens `status: 404` to `number`, which no declared
response admits.

**A body under a media type that is not JSON** is served as the document says it is. A string declared
`text/plain` is the text, validated like any other body. Raw bytes are handed to Hono unread. A model
declared under `application/xml` has no serialisation this emitter can derive, so the handler returns
the text and it is served without validation; the compile says so with
`unvalidated-response-media-type`.

## Middleware

Register middleware before `registerRoutes`. Hono applies middleware only to routes registered after
it, and `registerRoutes` registers everything at once. Middleware added afterwards does not error, it
simply never runs.

```ts
const app = new Hono<AppEnv>();

app.use(cors()); // global
app.use("/widgets/*", rateLimit()); // per resource
app.use("/widgets/:widget-id", cache()); // per route

const routes = registerRoutes(app, handlersFor, deps); // everything above applies
```

Per-resource middleware works through a prefix wildcard rather than a handle on the sub-app, because
the sub-apps are local to `registerRoutes`. Every route of a resource is mounted under that resource's
prefix, so `/widgets/*` is equivalent.

`app.onError` and `app.notFound` are app-level handlers rather than route middleware and may be
registered in any order.

### What the document cannot state, and therefore neither can this

Routing, validation and every declared response come from the spec. A set of things a production
server needs are **not** in the spec, because OpenAPI has no keyword for them, so this emitter cannot
derive them and does not write them. They are yours, and Hono ships all of them.

| what                 | why it is not generated                                         | Hono's                   |
| -------------------- | --------------------------------------------------------------- | ------------------------ |
| a request size limit | OpenAPI states no maximum body size                             | `hono/body-limit`        |
| security headers     | not a property of the API, of the deployment                    | `hono/secure-headers`    |
| CORS                 | which origins may call you is not in the document               | `hono/cors`              |
| CSRF                 | depends on your credential model, which the spec does not state | `hono/csrf`              |
| a request timeout    | not expressible, and platform-dependent                         | `hono/timeout`           |
| rate limiting        | not expressible                                                 | yours, or the platform's |
| a request id         | not expressible                                                 | `hono/request-id`        |

**The request size limit is the one to set first**, because without it a generated route will buffer,
parse and validate whatever arrives. Re-measured on hono 4.13.8 / zod 4.6.5 under `wrangler dev` on
`workerd`: a 96 MB JSON body (100,664,272 bytes) was accepted, validated and served back with 200 in
1.6 s, inside a 128 MB isolate. 8 MB, 32 MB and 64 MB all answered 200 as well.

```ts
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";

const app = new Hono<AppEnv>();
app.use(secureHeaders());
app.use(bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "too_large" }, 413) }));

const routes = registerRoutes(app, handlersFor, deps); // everything above applies
```

A `bytes` body is handed over as an unread stream, so an upload route can enforce its own cap while
reading instead - see [Request bodies](#request-bodies). `bodyLimit` reads `Content-Length` and
counts what arrives, so it covers the buffered cases the stream idiom does not.

## Hono RPC (`hc`)

`registerRoutes` chains its registrations and returns the result, which is what Hono's RPC client
reads:

```ts
import { hc } from "hono/client";

const client = hc<typeof routes>("https://api.example.com");
const response = await client.widgets[":widget-id"].$get({
	param: { "widget-id": "w-1" },
	header: { "x-request-id": "r-1" },
});
```

Use the returned value, not the instance you passed in. `hc` reads the `Schema` type Hono accumulates
through the chain, and the bare `new Hono()` carries none of it.

Each declared response is typed by its status, so checking `status` narrows the body:

```ts
const response = await client.widgets[":widget-id"].flags.$put({
	param: { "widget-id": "w-1" },
	json: {},
});
if (response.status === 404) {
	const notFound = await response.json(); // { code: string }
}
if (response.status === 429) {
	const throttled = await response.json(); // { reason: string }
}
```

Responses produced by middleware - `noContext`, `invalid`, `notAcceptable` - are not part of any
route's type, which is also true of `@hono/zod-openapi`.

## Authentication

`@useAuth(BearerAuth)` publishes `security: [{ "BearerAuth": [] }]`, and `deps.authorize` receives
exactly that:

```ts
deps.authorize([{ BearerAuth: [] }]); // one scheme, no scopes
deps.authorize([{ OAuth2Auth: ["widgets:read"] }]); // scopes, from the declared flows
deps.authorize([{ OAuth2Auth: [] }, { BearerAuth: [] }]); // either one authorises
deps.authorize([{}, { BearerAuth: [] }]); // `NoAuth | BearerAuth`: anonymous, or the token
```

`{}` is the requirement `@useAuth(NoAuth | ...)` publishes: it names no scheme, so it is satisfied by
every caller. An operation whose every alternative is `NoAuth` carries no gate at all.

Satisfying any one requirement authorises the caller, and every scheme within one requirement must be
satisfied together. That is what an array of OpenAPI `security` objects means. Which credentials
satisfy a scheme is yours to implement; which schemes an operation accepts is generated.

## Base path

`@server("/api/v1")` reaches OpenAPI as `servers: [{ url: "/api/v1" }]`, and an OpenAPI path is
relative to its server, so the document publishes `/api/v1/accounts`. Routes are mounted under that
prefix with a nested `app.route()`.

A service declaring several servers is mounted under each of them, since the document says it answers
at all of them. A templated server such as `@server("{endpoint}")` means the caller supplies the whole
origin, so routes mount at the root.

## HEAD operations

Hono rewrites every HEAD request to GET before route matching, so a route registered under HEAD is
never reached. A `@head` operation is therefore registered under GET, and `c.req.method` still reads
`HEAD` inside the handler, which is how the two are told apart. Hono strips the response body for a
real HEAD request itself.

Where a path declares only `@head`, a guard rejects a real GET with a 404, since the document declares
no GET there. Where a path declares both, one registration serves both and each operation keeps its
own handler.

## Request bodies

The `@hono/zod-validator` target is chosen from what the document says the wire carries: `json` for
`application/json` and `+json` suffixed types, `form` for `multipart/*` and
`application/x-www-form-urlencoded`.

Where an operation declares several media types needing different parsers, the validator is chosen
from the request's `Content-Type` at request time, since that is the only point at which the answer
exists.

**A `Content-Type` the operation does not declare is refused**, through `deps.invalid`, with an issue
naming what the operation does accept. Parameters are not part of the match, so
`application/json; charset=utf-8` is `application/json`. A request carrying no `Content-Type` at all
is refused too: the document says which media types an operation takes, and none of them is "absent".

A `bytes` body is handed over as the **unread stream** for binary media types, typed
`ReadableStream<Uint8Array> | null`, and read with `text()` otherwise, so bytes that are not valid
UTF-8 reach the handler intact. An `Http.File` body is the unread stream whatever its media type, with
the type it was sent as under `"Content-Type"`. A model declared only under a media type nothing
parses is handed over under the body's name as it arrived: the text under a textual media type such
as `application/xml`, and the unread stream under any other, such as `application/octet-stream`.

An optional body that was not sent is absent from the input: `"body" in input` is `false`, not a key
holding `undefined`.

`null` is not an error case. It is what the platform reports for a request carrying no body at all,
and a zero-byte upload is a legitimate thing to write.

Reading the bytes is one line where you want them:

```ts
const bytes = await new Response(input.body).arrayBuffer();
```

Piping them is why the stream is handed over unread. `arrayBuffer()` materialises the whole payload
in the isolate, and a Worker gets 128 MB against a request-body limit of 100 MB, so an upload at the
documented maximum could not be served at all.

## Upgrading

### To `0.26.0`

`0.26.0` requires `typespec-http-zod` `0.29.0`. Read its "To `0.29.0`" section: three of its changes
make a route refuse a request it accepted, and in each the published document already refused it.
The one a client is likeliest to meet: **a `utcDateTime` or `offsetDateTime` header with no
`@encode` is an HTTP-date**, `Fri, 26 Aug 2022 14:38:00 GMT`, on requests and on the responses a
handler sets. To keep RFC 3339 on the wire, declare it, and the document will say it too:

```tsp
@header @encode(DateTimeKnownEncoding.rfc3339) since: utcDateTime;
```

The validators also carry `.describe(...)`, so a snapshot of `schemas.gen.ts` changes. Nothing a
route decides does.

### To `0.25.0`

`0.25.0` requires `typespec-http-zod` `0.28.0`, whose contract types now state each operation's input
and result exactly as a handler here receives and returns them. Read its "To `0.28.0`" section if you
use `requests.gen.ts`.

#### A backend typed by the contracts is forwarded to as it is

A backend reached over a service binding, typed `(input: WireInputs[op]) => Promise<WireResults[op]>`,
is a handler body on its own:

```ts
const handlersFor = (c: Context<AppEnv>) =>
	({
		scheduleDeletion: (_ctx, input) => c.env.BACKEND.scheduleDeletion(input),
	}) satisfies Operations;
```

Delete any code that flattened a handler's input or mapped a backend's `{ status: number }` result.

#### What a handler receives

- **An optional body that was not sent is absent**, rather than present holding `undefined`.
  `input.body === undefined` still reads the same. That is a parsed body: a raw one is handed over as
  the request carried it, so an absent text body is `""` and an absent binary body is `null`.
- **A body that sends a key a parameter also has is under its own name**, beside the parameter, rather
  than merged into it: merged, the body's value replaced the parameter's. The body is under its
  `@body` parameter's name, so for `@body body: Entry` read `input.body.x` where a handler read
  `input.x`, and typecheck before deploying: wrangler bundles without typechecking, and a handler
  still reading `input.x` reads `undefined`. A read-only body property is not sent, so a
  model whose `id` is read-only beside `@path id` still merges.
- **An `Http.File` upload arrives**, as `ReadableStream<Uint8Array> | null` under its parameter's
  name, with the media type it was sent as under `"Content-Type"`. It used to arrive as `{}`. That
  media type is checked against the ones the file declares, so another is refused through
  `deps.invalid`, as a header that breaks its declaration is.
- **A body declared only as XML arrives as its text**, under the body's name, and nothing checks it:
  `unvalidated-request-media-type` says so at build time. It used to be dropped.
- **An input made only of an empty model is `{}`**, rather than `unknown`.

#### What a handler returns

- **A defaulted response property may be left out.** The result body is typed from the schema's
  input, which is what the server checks, so `count?: int32 = 0` is optional there and served as `0`.
  Code that READS a result - a test calling a handler, a caller of `Operations` over RPC - sees it as
  optional too, `count?: number`; Hono's client is unaffected, because what is served is the output.
- **A binary or streamed body may be any `ByteStream`**, the reader every stream has, as well as a
  platform stream, a `Uint8Array` or an `ArrayBuffer`. The new runtime helper `servedBytes` serves it.
  A stream of anything but `Uint8Array` chunks, such as a `ReadableStream<string>`, no longer
  compiles: encode it with `.pipeThrough(new TextEncoderStream())`. Node refused such a stream when
  it was served, and only workerd sent it.
- **An `Http.File` download returns its bytes.** It used to be served empty, so a handler returning
  nothing now fails to compile.
- **A response header declared with `@encode` takes its encoded type**: `@encode(seconds, int32)
retryAfter: duration` is a `number`, which is what the server checks it against.

#### What is emitted

Every `runtime.gen.ts` changes, whether or not its service uses streams: `ByteStream` and
`servedBytes` are added. A build id or cache key computed from the generated sources changes with it.

#### TypeSpec 1.17

Built and graded against TypeSpec 1.17.

### To `0.24.0`

**Nothing here reaches you until you ask for it.** A `^0.x` range pins the minor, so `^0.23.0` never
resolves `0.24.0`; every consumer moves deliberately. This page is what to read when you do.

`0.24.0` requires `typespec-http-zod` `0.27.0`, which it pulls in for you, so its changes arrive in
the same step. They are listed at the end.

**Enable the linter while you are here.** Two checks that used to be automatic warnings are now
opt-in rules, because the spec is valid and the output is correct in both cases and TypeSpec reserves
automatic diagnostics for a program its library cannot serve:

```yaml
# tspconfig.yaml
linter:
  extends:
    - "typespec-hono/recommended"
```

That turns on `regexp-router-unsupported`, which matters only if you construct your app with a bare
`RegExpRouter`, and `redos-prone-pattern`, which matters to everyone. A finding you have considered
and decided to keep is acknowledged where it is declared:

```tsp
#suppress "typespec-hono/regexp-router-unsupported" "Mounted with the default router, which holds this route set"
@service(#{ title: "Widgets" })
namespace Widgets;
```

If you set `warn-as-error: true`, enabling the ruleset is what decides whether these stop your build.

#### The media type a request declares is enforced

**A request whose `Content-Type` the operation does not declare is now refused.** It used to be
parsed as though it carried the first media type the document lists, which meant a route publishing
`application/json` alone answered 200 to the same body sent as `text/plain`, as `multipart/form-data`,
or with no `Content-Type` at all.

Nothing in your code changes. What changes is what some callers get:

| the caller sends                            | before | now                      |
| ------------------------------------------- | ------ | ------------------------ |
| the declared media type                     | served | served                   |
| it with `; charset=utf-8`                   | served | served                   |
| a media type the operation does not declare | served | `deps.invalid`, your 400 |
| no `Content-Type` at all                    | served | `deps.invalid`, your 400 |

The last two are the ones to check before upgrading. `fetch` with a string body sends `text/plain`
unless told otherwise, and a hand-written client may send nothing, so a caller that worked by
accident will stop. `@typespec/http-server-js`, TypeSpec's own reference server, has always refused
this case; the divergence was ours.

**A declared response header whose value the document forbids now throws.** It used to be served. If
a handler builds a header from user input or from a service binding, check it against what the spec
says before this release, because `app.onError` will start seeing `ResponseContractError` with
`part: "headers"` where it saw nothing.

**A body too deeply nested to parse is refused rather than answered 500.** It reaches `deps.invalid`
like any other bad request. If your `onError` counted `RangeError`s, it will stop seeing them.

#### A declared media RANGE now admits the types inside it

`@header contentType: "text/*"` used to emit a check for the literal text `text/*`, which no client
sends, so every real request was refused. The full wildcard was worse. Measured at the wire on a
route declaring `"*/*"`, before this release:

| the caller sends   | before | now    |
| ------------------ | ------ | ------ |
| `application/json` | 400    | served |
| `text/plain`       | 400    | served |
| `image/png`        | 400    | served |
| the literal `*/*`  | served | served |

If you avoided declaring a range because of this, you no longer need to. Nothing you have to change.

#### A required `@cookie` is enforced

It used to reach no validator and no handler input at all, while the published document said
`required: true`. A request missing one is now refused before your handler runs. If callers were
getting away with omitting it, they stop.

#### The `hono` peer floor is `^4.13.5`

Everything below it carries three advisories, two on a generated server's own request surface: the
query parser reading past the URL fragment, and `parseBody()` allowing unbounded dot-notation
nesting. `pnpm add hono@^4.13.5` if you are behind; a peer warning is what you will see otherwise.

#### The router caveat is a linter rule

`regexp-router-unsupported` no longer fires on every compile. If you construct your app with a bare
`RegExpRouter`, enable the ruleset above, because a route set it cannot compile throws inside
`registerRoutes` at module scope and the Worker never starts. If you use `new Hono()`, which is the
recommendation, you can ignore it: the default settles on `TrieRouter` and serves the same routes.

#### What `typespec-http-zod` 0.27.0 changes underneath you

It arrives with this release and its changes reach your generated validators. The ones with a runtime
effect, in full in that package's own upgrading notes:

- **a declared integer width is enforced** - a `uint8` that accepted `-5` and `100000` now answers 400. Worth knowing: the published document spells a width as `format`, which JSON Schema treats as
  an annotation, so a client generated from your document will go on accepting values your server now
  refuses;
- **a `@pattern` is compiled with the Unicode flag** where the flag accepts it, which changes
  matching where a pattern counts characters or names a property: measured, `^.{3}$` accepts
  `a<emoji>b` now and refused it before, which is what the document always said;
- **a numeric bound on a value `@encode(string)` carries as text is dropped** and named, rather than
  mistranslated into a check on the value's length;
- **two types with one name, or a reference cycle with no declaration on it, are refused** rather
  than emitted into a module that cannot compile. Both match a diagnostic `@typespec/openapi3` raises
  on the same spec.

### To `0.23.0`: responses are returned, and the runtime is no longer yours to replace

This release changes what every handler returns and what `deps` provides. Each step below is
mechanical, and the compiler names every place that needs one.

**A handler returns `{ status, body }`.**

```ts
// before
WidgetRoutes_read: (ctx, input) => widgets.get(input.id),
// after
WidgetRoutes_read: (ctx, input) => ({ status: 200, body: widgets.get(input.id) }),
```

A declared failure is returned the same way, rather than thrown to `onError`. See
[Responses, successes and failures alike](#responses-successes-and-failures-alike).

**`deps.respond` is gone.** The generated route serves each declared response itself. What a
`respond` used to do moves as follows:

| a `respond` that...                                     | now                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| picked a status from the result                         | the handler returns `status`                                           |
| mapped a domain error code to a status and an envelope  | a handler adapter returning the declared failure response              |
| validated the body against `arm.schema`                 | done by the generated route, for failures too                          |
| turned a validation failure into a 500 or 502           | `app.onError`, on `ResponseContractError`                              |
| set headers from a sidecar on the result                | the handler returns `headers`, keyed by wire name                      |
| passed through a `Response` for a download or a stream  | the handler returns the `ReadableStream` or bytes as the declared body |
| wrapped a success in an envelope such as `{ ok, data }` | the handler returns the envelope the document declares as the body     |
| reported telemetry or redacted a message                | `app.onError`, or middleware after `await next()`                      |

**A backend reached over a service binding** keeps returning whatever it returns. The handler set
becomes an adapter over it, typed against the document:

```ts
const handlersFor = (c: Context<AppEnv>) => {
	const backend = c.env.BACKEND;
	return {
		Notes_read: async (ctx, input) => {
			const result = await backend.readNote(ctx, input.path);
			if (result.ok) return { status: 200, body: result.data };
			return result.error.code === "NOT_FOUND"
				? { status: 404, body: { error: result.error.message } }
				: { status: 502, body: { error: "upstream failure" } };
		},
	} satisfies Operations<Caller>;
};
```

A code mapped to a status the document does not declare now fails to compile, which is the point.

**`runtime-module` is refused.** Delete the module it pointed at, and the copy of `armFor`,
`selectContentType` and `headOnly` inside it. What that module declared moves:

- **`Ctx`** is inferred from `deps.context`. Type `deps` as `RouteDeps<AppEnv, Caller>` and every
  handler receives a `Caller`.
- **`AppEnv`** is augmented rather than re-declared:
  `declare module "./generated/runtime.gen.js" { interface AppEnv { Bindings: ...; Variables: ... } }`.
  Write the augmentation in a file that does not also declare or import an `AppEnv` of its own:
  there, the augmented interface reads to `no-shadow` (oxlint's and ESLint's) as shadowing it.
- **`Result<T>`** has no replacement, because what a handler returns is now the union of the
  responses the document declares.

**A handler returns data, never a `Response`.** The result type is the union of the responses the
document declares, and a `Response` is none of them, so it does not compile. A response header the
document does not declare is not sent: the route serves only the headers each response declares, so
declare one to send it.

**A handler alias takes the caller context**: `WidgetRoutes_readHandler<Caller>`.

**`deps.context` is told the operation's authentication, which may be `"optional"`.** It is called
with `"none"`, `"optional"` or `"required"`; a hook typed for two of them no longer compiles. Widen
its parameter to all three.

**`typespec-http-zod` 0.26.0 comes with this release**, and renames what `schemas.gen.ts` declares
for a response: `<operationId>Response` is `<operationId>Response<status>`, and a `ResponseArm` has no
`when` or `property` any more. Code that imported an inline response schema, or read the arms, follows
the rename; the library's CHANGELOG lists each.

**A compile refused for `runtime-module` writes nothing from 0.25.0.** On 0.23.0 and 0.24.0 it
reports the error and emits anyway, so `app.gen.ts`, `schemas.gen.ts` and `runtime.gen.ts` are
rewritten in your tree. On either, remove the option, compile again, and commit what it writes.

**A concrete path now wins over a templated one.** `GET /items/plain` was answered by `/items/{id}`
whenever the templated route was declared first, because Hono runs the first match. Routes are
registered concrete-first, which is what OpenAPI states.

### To `0.19.0`: a streamed request body

**The streamed request body is the one hand-edit.** If you have an upload route, moving to
`typespec-hono@0.19.0` or later changes what its handler receives, and the compile error does not
name the change:

```
TS2345: Type '{ path: string } & { body: ReadableStream<Uint8Array> | null }' is not assignable to
  type '{ path: string; body: ArrayBuffer }' with 'exactOptionalPropertyTypes: true'.
```

The fix is usually an improvement rather than a translation, because a per-file cap can now be
enforced **while reading** instead of after the whole body has been buffered:

```ts
async function bodyBytes(
	body: ReadableStream<Uint8Array> | null,
	limit: number,
): Promise<Uint8Array> {
	if (body === null) return new Uint8Array(0);
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel();
			throw new TooLarge(limit);
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.byteLength;
	}
	return out;
}
```

A consumer who made this move reported that it made their 413 cheaper rather than merely different:
the request is cancelled at the first chunk that crosses the line.

Nothing else in that move needed a hand-edit.

## Streaming

An operation returning `SSEStream<...>` or `JsonlStream<...>` declares a streamed body, and its handler
returns the stream:

```ts
const feed: FeedHandler<Caller> = (ctx, input) => ({
	status: 200,
	body: eventsFor(input.channel).pipeThrough(new TextEncoderStream()),
});
```

The route hands the stream to `c.body` unread, under the declared media type. A binary body -
`bytes` under `application/octet-stream` or an image type - is returned the same way, as a
`ReadableStream`, a `Uint8Array` or an `ArrayBuffer`.

Validators are middleware, so they run before the handler. A request the document forbids is refused
with an ordinary response and the stream is never opened.

## Observability

This package ships no instrumentation. Two properties an APM needs are asserted by the test suite:

- `c.req.routePath` yields the route pattern, `/widgets/:widget-id`, rather than the concrete URL, and
  survives being mounted through a sub-app. That is the span name you want.
- A handler's `throw` reaches an app-level `onError`. Nothing in the generated file swallows it.
- A response body the document does not permit reaches `onError` as `ResponseContractError`, and a
  status the operation does not declare as `UndeclaredStatusError`, so contract drift is reported in
  the one place Hono gives an application for failures.
