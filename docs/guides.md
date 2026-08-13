# Guides

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

## Authentication

`@useAuth(BearerAuth)` publishes `security: [{ "BearerAuth": [] }]`, and `deps.authorize` receives
exactly that:

```ts
deps.authorize([{ BearerAuth: [] }]); // one scheme, no scopes
deps.authorize([{ OAuth2Auth: ["widgets:read"] }]); // scopes, from the declared flows
deps.authorize([{ OAuth2Auth: [] }, { BearerAuth: [] }]); // either one authorises
```

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

A `bytes` body is read with `arrayBuffer()` for binary media types and `text()` otherwise, so bytes
that are not valid UTF-8 reach the handler intact.

## Streaming

A generated operation returns a value rather than a `Response`, so streaming happens in `deps.respond`,
which may return any `Response`:

```ts
const deps: RouteDeps = {
	respond: (c, arms, result) =>
		streamSSE(c, async (stream) => {
			for await (const item of pageThrough(result)) {
				await stream.writeSSE({ data: JSON.stringify(item) });
			}
		}),
};
```

Validators are middleware, so they run before anything is streamed. A request the document forbids is
refused with an ordinary response and never opens a stream.

Point `runtime-module` at your own module and re-declare `Result<T>` if you want the handler's return
type to carry the stream shape.

## Observability

This package ships no instrumentation. Two properties an APM needs are asserted by the test suite:

- `c.req.routePath` yields the route pattern, `/widgets/:widget-id`, rather than the concrete URL, and
  survives being mounted through a sub-app. That is the span name you want.
- A handler's `throw` reaches an app-level `onError`. Nothing in the generated file swallows it, and
  `deps.respond` is only reached on success.
