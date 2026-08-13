# typespec-hono

Generate a [Hono](https://hono.dev) server, and the Zod validators it enforces, from a TypeSpec HTTP
service definition.

It reads your `.tsp` source, not an OpenAPI document. [`@typespec/openapi3`](https://typespec.io)
reads the same source and writes the OpenAPI document; neither emitter consumes the other's output.
Because both are generated from one definition, the server enforces what the document describes,
without anyone having to keep the two in step by hand.

This package runs [`typespec-http-zod`](https://github.com/bison-digital/typespec-http-zod) and adds
one file, so listing one emitter produces five artefacts.

## Install

```bash
npm install --save-dev typespec-hono
```

A devDependency, like any TypeSpec emitter. The generated code imports no part of this package: the
small runtime it needs is written beside it as `runtime.gen.ts`, so the only packages your server
needs at run time are `hono`, `@hono/zod-validator` and `zod`, which you are installing anyway.

Peer dependencies: `hono`, `@hono/zod-validator`, `zod`, `@typespec/compiler`.

```yaml
# tspconfig.yaml
emit:
  - typespec-hono
options:
  typespec-hono:
    emitter-output-dir: "{project-root}/src/generated"
    seal-object-schemas: true
```

## What it emits

`app.gen.ts`, plus everything `typespec-http-zod` emits. See its README for the other four files.

Routes are grouped into a sub-app per resource and mounted with `app.route()`, following
[Hono's best-practices guide](https://hono.dev/docs/guides/best-practices). Handlers are written
directly after the path definitions rather than lifted into separate controller files, because a
handler in another file cannot infer its path parameters. A resource with a single route gets no
sub-app.

The output is plain `Hono` and `@hono/zod-validator`, not `@hono/zod-openapi`. That package generates
a document from the code, which would compete with the one openapi3 publishes from the spec.

```ts
import { Hono } from "hono";
import { registerRoutes } from "./generated/app.gen.js";

// Leave handlersFor unannotated. Annotating it widens the value and disables the
// exhaustiveness check that catches a handler for an operation the spec no longer declares.
const handlersFor = (c) => backendFor(c.env);
const routes = registerRoutes(new Hono<AppEnv>(), handlersFor, deps);

export default routes;
```

`handlersFor` is a factory rather than an object because a Workers service binding lives on `c.env`
and exists only for the duration of a request.

### Hono RPC

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

### Base path

`@server("/api/v1")` reaches OpenAPI as `servers: [{ url: "/api/v1" }]`, and an OpenAPI path is
relative to its server, so the document publishes `/api/v1/accounts`. Routes are mounted under that
prefix with a nested `app.route()`.

A service declaring several servers is mounted under each of them, since the document says it answers
at all of them. A templated server such as `@server("{endpoint}")` means the caller supplies the whole
origin, so routes mount at the root.

### Authentication

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

### HEAD operations

Hono rewrites every HEAD request to GET before route matching, so a route registered under HEAD is
never reached. A `@head` operation is therefore registered under GET, and `c.req.method` still reads
`HEAD` inside the handler, which is how the two are told apart. Hono strips the response body for a
real HEAD request itself.

Where a path declares only `@head`, a guard rejects a real GET with a 404, since the document declares
no GET there. Where a path declares both, one registration serves both and each operation keeps its
own handler.

### Request bodies

The `@hono/zod-validator` target is chosen from what the document says the wire carries: `json` for
`application/json` and `+json` suffixed types, `form` for `multipart/*` and
`application/x-www-form-urlencoded`.

Where an operation declares several media types needing different parsers, the validator is chosen
from the request's `Content-Type` at request time, since that is the only point at which the answer
exists.

A `bytes` body is read with `arrayBuffer()` for binary media types and `text()` otherwise, so bytes
that are not valid UTF-8 reach the handler intact.

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

## Cloudflare Workers

### Router choice

You construct the `Hono` instance, so the router is your choice. Measured on a generated 580-operation
service (58 resources, 10 operations each), three runs, Hono 4.13.1:

| router                       | register   | first request | 1000 requests |
| ---------------------------- | ---------- | ------------- | ------------- |
| SmartRouter (Hono's default) | 5.4-6.1 ms | 18.5-18.9 ms  | 24-26 ms      |
| RegExpRouter                 | 2.6-4.4 ms | 2.2-2.6 ms    | 16-18 ms      |
| LinearRouter                 | 1.1-1.2 ms | 0.6 ms        | 66-70 ms      |
| PatternRouter                | 2.7-2.9 ms | 2.5 ms        | 36-39 ms      |

SmartRouter selects a router by trying one, and that work happens on the first request rather than at
registration. At this scale it costs around 18.8 ms of CPU, and the Workers free plan allows 10 ms of
CPU per request, so the first request into a new isolate can be killed with `exceededCpu`.

`RegExpRouter` is the recommendation for a generated app:

```ts
import { Hono } from "hono";
import { RegExpRouter } from "hono/router/reg-exp-router";

const routes = registerRoutes(new Hono<AppEnv>({ router: new RegExpRouter() }), handlersFor, deps);
```

Choose `LinearRouter` instead only for a low-traffic Worker where cold start dominates. It is the
cheapest to start and roughly four times slower per request thereafter.

### Bundle size

|                | raw      | gzip      | share of the 3 MB free limit |
| -------------- | -------- | --------- | ---------------------------- |
| 20 operations  | 642 KiB  | 100.8 KiB | 3.3%                         |
| 580 operations | 1008 KiB | 112.6 KiB | 3.7%                         |

560 additional operations cost around 12 KiB gzipped. The baseline is Hono and Zod rather than the size
of your API, and router choice moves it by under 1 KiB. Limits are 3 MB gzipped on the free plan and
10 MB on paid.

`registerRoutes` runs at module scope in 1.1-6.1 ms, within the 1 second startup budget. Nothing here
requires `nodejs_compat`.

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

## Options

Every option `typespec-http-zod` accepts is forwarded, and the schema is derived from that package's
rather than restated. See its README for `seal-object-schemas`, `contracts-output-dir`,
`contracts-package`, `key-vocabularies`, `runtime-module` and `services`.

`runtime-module` is the option most consumers set. Point it at a module of your own that re-declares
`Result`, `Ctx`, `AppEnv` and `RouteDeps`, and every generated signature carries your types instead of
the identity defaults.

## What it refuses, and why

| code                        | why                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unvalidatable-media-type`  | The document declares a request media type no `zValidator` target can parse, most commonly `application/xml`. The route is still mounted and still validates every type that can be parsed, chosen from the request's `Content-Type`. Requests carrying the others are refused rather than parsed as something they are not. |
| `unsupported-path-template` | A path parameter whose wire name carries a character Hono cannot hold in a route parameter: a space, `+` or `!`. Reachable only through `@path("...")` with a non-identifier wire name. The route is registered at the literal template, so it matches nothing rather than matching the wrong requests.                      |

RFC 6570 operators are not affected by the second of these. `@typespec/http` resolves them before this
emitter sees the path and `@typespec/openapi3` strips them from the published document, so
`@route("/files{+path}")` reaches both as `/files{path}` and the two artefacts agree.

### Refusals are warnings

A refusal is reported as a warning, so a compile containing one still succeeds and still emits
everything else, including openapi3's document.

That matters because a TypeSpec `error` sets `program.hasError()`, and openapi3 declines to write
anything when the program has errors, including errors that are not its own. As errors, these refusals
would cost a consumer their entire OpenAPI document, depending on the order emitters were listed in.

It also follows openapi3's own convention, which uses `warning` for the same shape
(`streams-not-supported`, `unsupported-auth`), meaning the spec is valid and this emitter cannot
express it, and reserves `error` for a spec that is wrong for any emitter.

To make a refusal fail the build, use the compiler's own switch:

```yaml
# tspconfig.yaml
warn-as-error: true
```

## Known limits

- **XML request bodies are not validated.** There is no Hono parser and no Zod representation for XML,
  and the mapping from XML to a JavaScript object is not canonical. An operation declaring
  `application/xml` alongside a parseable type still validates the parseable ones; requests carrying
  XML are refused, and `unvalidatable-media-type` names it at build time.
- **`int64` and `uint64` are validated as JavaScript numbers**, so values above 2^53-1 are refused.
  Above that point an integer is not uniquely representable as a JavaScript number, so a validator
  cannot certify that the value it holds is the value that was sent. Use `@encode(string)`, which is
  TypeSpec's own remedy and which this emitter renders as `z.string()`.
- **`app.on(method, ...)` is not reachable from any current TypeSpec spec**, because `@typespec/http`
  declares six verbs and five have dedicated Hono helpers. The branch is exercised directly by
  `test/render.test.ts` rather than deleted, so a verb TypeSpec adds later does not emit
  `app.undefined(...)`.

## How it is graded

- **Route surface over a corpus we did not write**: 61 scenarios from `@typespec/http-specs`, with
  counts read from `app.routes` after mounting the real `registerRoutes` rather than from the emitted
  text. 577 declared, 577 mounted, 0 refused, 27 partially validated. `mounted + refused === declared`
  is asserted, because `mounted === declared` can be satisfied by a route nobody can reach.
- **An application is compiled against the output**, with `runtime-module` pointed at a module
  substituting real types, and with no cast anywhere.
- **Equivalence against a hand-written Hono app** following the pattern in Hono's own validation
  guide, written without reference to this emitter's output. Both serve the same API, answer thirteen
  identical exchanges identically, and both routing tables are compared.
- **Real requests through the real router**, which is the only thing that can detect a
  validator-to-wire defect.

## Licence

MIT
