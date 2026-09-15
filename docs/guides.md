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

A `bytes` body is handed over as the **unread stream** for binary media types, typed
`ReadableStream<Uint8Array> | null`, and read with `text()` otherwise, so bytes that are not valid
UTF-8 reach the handler intact.

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
- **`Result<T>`** has no replacement, because what a handler returns is now the union of the
  responses the document declares.

**A handler alias takes the caller context**: `WidgetRoutes_readHandler<Caller>`.

**A concrete path now wins over a templated one.** `GET /items/plain` was answered by `/items/{id}`
whenever the templated route was declared first, because Hono runs the first match. Routes are
registered concrete-first, which is what OpenAPI states.

### To `0.20.0`: a streamed request body

**The streamed request body is the one hand-edit.** If you have an upload route, moving to
`typespec-hono@0.20.0` or later changes what its handler receives, and the compile error does not
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
