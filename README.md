# typespec-hono

Generate a [Hono](https://hono.dev) server — and the Zod validators it enforces — from a TypeSpec HTTP
service, agreeing with the OpenAPI document [`@typespec/openapi3`](https://typespec.io) publishes from
the same source.

This package runs the whole of
[`typespec-http-zod`](https://github.com/bison-digital/typespec-http-zod) and adds one file. **A
consumer lists one emitter and gets five artefacts.**

## Why one emitter and not two

The server and the validators share a naming contract: `app.gen.ts` imports `readWidgetPath` and
`readWidgetResponses` from `schemas.gen.js` **by name**. Two separate TypeSpec emitters would each get
their own `$onEmit` and their own registry, and would have to arrive at identical identifiers by
coincidence. Running the library from inside this one means it mints the names, writes them, and hands
them back — so the agreement is structural.

If you want the validators without a server, install `typespec-http-zod` alone. Nothing here is
required for that.

## Install

```bash
npm install --save-dev typespec-hono
```

Peers: `hono`, `@hono/zod-validator`, `zod`, `@typespec/compiler`.

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

`app.gen.ts`, plus everything `typespec-http-zod` emits — see its README for the other four.

Routes are grouped into a **sub-app per resource** and mounted with `app.route()`, which is what
[Hono's best-practices guide](https://hono.dev/docs/guides/best-practices) recommends for building a
larger application. Its other recommendation is honoured at the same time and matters more: handlers
are written **directly after the path definitions**, never lifted into Rails-style controllers, because
a handler in a separate file cannot infer its path parameters. A resource with one route gets no
sub-app — that is ceremony around a single line, and not what an author writes.

Measured before relying on it: `app.route(prefix, sub)` composes paths exactly, including a parameter
in the prefix, and the parent's `app.routes` reports the fully composed path — so every arm that
counts routes still counts them.

The server is **plain `Hono` and `@hono/zod-validator`**, deliberately not `@hono/zod-openapi`. That
package is the same validation plus a document generated FROM the code — spec-last, and a second
source of truth competing with the one openapi3 publishes from the spec. We want its validation, not
its documentation.

```ts
import { Hono } from "hono";
import { registerRoutes } from "./generated/app.gen.js";

// ⚠️ Unannotated on purpose — annotating widens the value and disables the exhaustiveness check.
const handlersFor = (c) => backendFor(c.env);
const routes = registerRoutes(new Hono<AppEnv>(), handlersFor, deps);

export default routes;
```

### Hono RPC (`hc`) works, and the return value is why

`registerRoutes` **chains** its registrations and hands back the result, so Hono's RPC client gets a
fully typed surface derived from the same document:

```ts
import { hc } from "hono/client";

const client = hc<typeof routes>("https://api.example.com");
const response = await client.widgets[":widget-id"].$get({
  param: { "widget-id": "w-1" },
  header: { "x-request-id": "r-1" },
});
```

⚠️ **Use the RETURNED value, not the instance you passed in.** `hc` reads the `Schema` type Hono
accumulates through the chain; the bare `new Hono()` still carries nothing. Measured before this
worked: `hc<typeof app>` resolved to `unknown` — not an empty client, an unusable one.

`handlersFor` is a **factory** rather than an object because in Workers a service binding lives on
`c.env` and exists only for the duration of a request — there is no module scope in which
`backendFor(env)` can be resolved.

## Middleware — register it BEFORE `registerRoutes`

⚠️ **This is the one ordering rule, and getting it wrong fails silently.** Hono middleware applies
only to routes registered *after* it, and `registerRoutes` registers everything at once. Middleware
added afterwards does not error — it simply never runs.

```ts
const app = new Hono<AppEnv>();

app.use(cors());                       // ✅ global
app.use("/widgets/*", rateLimit());     // ✅ per resource
app.use("/widgets/:widget-id", cache()); // ✅ per route

const routes = registerRoutes(app, handlersFor, deps);  // ← everything above applies

app.use(cors());                        // ❌ silently applies to nothing
```

All three scopes are reachable and each is asserted by a real request in
`test/wire/middleware.test.ts`. Per-resource works through a prefix wildcard rather than a handle on
the sub-app: the sub-apps are `const`s inside `registerRoutes`, and `/widgets/*` is the equivalent —
it works because every route of a resource is mounted under that resource's prefix.

`app.onError` and `app.notFound` are **not** subject to this: they are app-level handlers rather than
route middleware, and may be registered in any order.

## Cloudflare Workers — pick a router

You construct the `Hono` instance, so the router is your choice. **Make it deliberately.** Measured on
a generated **580-operation** service (58 resources × 10), three runs, on Hono 4.13.1:

| router | register | first request | 1000 requests |
| --- | --- | --- | --- |
| SmartRouter *(Hono's default)* | 5.4–6.1 ms | **18.5–18.9 ms** | 24–26 ms |
| **RegExpRouter** | 2.6–4.4 ms | 2.2–2.6 ms | **16–18 ms** |
| LinearRouter | **1.1–1.2 ms** | **0.6 ms** | 66–70 ms |
| PatternRouter | 2.7–2.9 ms | 2.5 ms | 36–39 ms |

⚠️ **The default is the worst choice here, and the reason is a cold-start cost you pay per isolate.**
SmartRouter picks a router by trying one, and that build happens on the **first request** rather than
at registration. At this scale that is ~18.8 ms of CPU — and the Workers **free plan allows 10 ms of
CPU per request**, so the first request into every new isolate can be killed with `exceededCpu`.

**Recommendation for a generated app: `RegExpRouter`.**

```ts
import { Hono } from "hono";
import { RegExpRouter } from "hono/router/reg-exp-router";

const routes = registerRoutes(new Hono<AppEnv>({ router: new RegExpRouter() }), handlersFor, deps);
```

Its reputation for slow registration does not bite here — it registered in under 5 ms and is fastest
in steady state. Choose `LinearRouter` instead only for a very low-traffic Worker where cold start
dominates: it is the cheapest to start and ~4× slower per request thereafter.

### Bundle size is not the constraint

| | raw | gzip | share of the 3 MB free limit |
| --- | --- | --- | --- |
| 20 operations | 642 KiB | 100.8 KiB | 3.3% |
| 580 operations | 1008 KiB | **112.6 KiB** | **3.7%** |

560 extra operations cost ~12 KiB gzipped — the baseline is Hono and Zod, not your API. Router choice
moves it by under 1 KiB, so do not choose a router for size. Limits are 3 MB gzipped on the free plan
and 10 MB on paid.

`registerRoutes` runs at module scope in 1.1–6.1 ms, comfortably inside the **1 second** startup
budget, despite the docs' warning that "generating or consuming a large schema at the top level is a
common cause of exceeding this limit".

Nothing here needs `nodejs_compat`: the generated server runs on `workerd` with no Node built-ins.

## Streaming

A generated operation returns a **value**, not a `Response`, so a handler cannot hand back a
`ReadableStream`. Streaming happens in `deps.respond`, which may return any `Response`:

```ts
const deps: RouteDeps = {
  // ...
  respond: (c, arms, result) =>
    streamSSE(c, async (stream) => {
      for await (const item of pageThrough(result)) {
        await stream.writeSSE({ data: JSON.stringify(item) });
      }
    }),
};
```

The validators are middleware, so they still run **before** anything is streamed — a request the
document forbids is refused with an ordinary response and never opens a stream. Both properties are
asserted by real requests in `test/wire/streaming.test.ts`.

Point `runtime-module` at your own module and re-declare `Result<T>` if you want the handler's return
type to carry the stream shape; that is the same seam the README describes for result envelopes.

## Observability

Nothing here is Sentry-specific, and this package deliberately ships no instrumentation — but two
properties an APM needs are asserted rather than hoped for:

- **`c.req.routePath` yields the route pattern**, `/widgets/:widget-id`, not the concrete URL. That is
  the span name you want; the URL would be a cardinality bomb. It survives being mounted through a
  sub-app, which is not obvious.
- **A handler's `throw` reaches an app-level `onError`.** Nothing in the generated file swallows it —
  `deps.respond` is only reached on success.

Both are pinned by real requests, so a change to how routes are grouped cannot quietly remove them.

## Options

Every option `typespec-http-zod` accepts, forwarded — the schema is **derived** from that package's,
not restated, and a test asserts the forwarding as a class at both the top level and inside the
per-service overrides. See its README for `seal-object-schemas`, `contracts-output-dir`,
`contracts-package`, `key-vocabularies`, `runtime-module` and `services`.

`runtime-module` is the one you are most likely to set: point it at a module of your own that
re-declares `Result`, `Ctx`, `AppEnv` and `RouteDeps`, and every generated signature carries your
types instead of the identity defaults.

## What it refuses, and why

Both refusals are about the target framework. `typespec-http-zod` emits correct validators for these
operations; only a Hono server cannot serve them.

| code | why |
| --- | --- |
| `unroutable-verb` | ⚠️ **A `@head` operation.** Hono rewrites every HEAD request to GET *before* matching — `hono-base.js` does it unconditionally at the top of `#dispatch` — so a route registered under HEAD is never reached: 404 where the path has no GET, dead code where it has one. Measured on Hono 4.13.1; `on("PURGE", …)` and `on("OPTIONS", …)` both work, so this is HEAD specifically. **The remedy is in your spec:** declare `@get`, and Hono answers HEAD from it with the body stripped, which is what RFC 9110 requires anyway. |
| `unsupported-path-template` | a path parameter that is not a plain name. Hono reads a parameter up to the next `/`, so an RFC 6570 operator or modifier would become part of the name — and `*` would become Hono's wildcard, mounting a route that matches the wrong requests and answers them. Refused rather than approximated, because a route that works and is wrong is worse than one that fails. |

## Known limits

- **Fifteen of the seventeen `@head` operations in `@typespec/http-specs` are refused**, and that is
  the honest count rather than a defect: they have no sibling `GET`, so Hono cannot route them at all.
  This emitter previously emitted them, and every route-counting arm called them mounted.
- **`app.on(method, …)` is reachable by no TypeSpec spec**, because `@typespec/http` declares six
  verbs, five have Hono helpers, and the sixth is `@head`, which is refused. The branch is exercised
  directly by `test/render.test.ts` rather than left untested or deleted — deleting it would make
  `HONO_METHOD[verb]` `undefined` for any verb TypeSpec adds later, emitting `app.undefined(...)`
  from a spec that compiles.

## How it is graded

- **Route surface over the corpus** — 61 scenarios of `@typespec/http-specs`, with counts read from
  `app.routes` after mounting the real `registerRoutes`, never from the emitted text. **577 declared,
  564 mounted, 13 refused**, and `mounted + refused === declared` is asserted, because
  `mounted === declared` can be satisfied by a route nobody can reach — and was.
- **An application is compiled against it**, with `runtime-module` pointed at a module that
  substitutes real types, and with no cast anywhere. A signature no application could satisfy passed
  every other test for a long time because the suite that mounted it cast to `unknown`.
- **Equivalence against a hand-written Hono app** — `test/equivalence/reference-app.ts` follows the
  pattern in Hono's own validation guide, written without reference to what this emitter produces.
  Both apps serve the same API and answer thirteen identical exchanges identically, and both routing
  tables are compared, because behaviour alone would miss two apps that happen to 404 together. ⚠️
  **Its value is entirely in its independence** — adjusted to match our output, it would prove only
  that we agree with ourselves, so when the two disagree the emitter is what changes.
- **Real requests through the real router** — the only thing that can see a validator-to-wire defect.
  A flattened collection parameter once had the document saying `array`, the validator saying `array`,
  and the server rejecting every conformant caller.

## Licence

MIT
