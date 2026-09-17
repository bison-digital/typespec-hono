# Cloudflare Workers

A generated server is a Worker. Nothing here needs `nodejs_compat`: the output runs on `workerd` with
no Node built-ins.

## A worker, end to end

```jsonc
// wrangler.jsonc
{
	"name": "widgets",
	"main": "src/index.ts",
	"compatibility_date": "2026-01-01",
}
```

```ts
// src/index.ts
import { Hono } from "hono";
import { registerRoutes } from "./generated/app.gen.js";
import { deps } from "./deps.js";
import type { AppEnv } from "./generated/runtime.gen.js";

const handlersFor = (c) => widgetsFor(c.env.DB);

// The default router. See "Which router to use" below before choosing another.
const app = new Hono<AppEnv>();
app.onError((error, c) => c.json({ error: error.message }, 500));

export default registerRoutes(app, handlersFor, deps);
```

```bash
pnpm exec wrangler dev
pnpm exec wrangler deploy
```

`handlersFor` takes the context because a binding such as `c.env.DB` exists only for the duration of a
request. There is no module scope in which to resolve it.

Middleware has to be registered before `registerRoutes`, which registers every route at once. See
[Guides](guides.md#middleware).

## Which router to use

Hono ships four routers and you choose one when you construct the app. The default is
`SmartRouter({ routers: [RegExpRouter, TrieRouter] })`, which tries `RegExpRouter` and falls back.

**Read the next section before changing it.** A bare `RegExpRouter` cannot compile every route set a
valid spec produces, and when it cannot, it throws inside `registerRoutes` at module scope - so the
Worker does not start and every route answers nothing.

Measured on a generated 360-operation service (120 resources, 3 operations each), Hono 4.13.1, each
request driven end to end through `app.request` rather than through `router.match` alone:

| router                       | register | first request | 1000 requests |
| ---------------------------- | -------- | ------------- | ------------- |
| SmartRouter (Hono's default) | 14.0 ms  | 39.4 ms       | 170 ms        |
| RegExpRouter                 | 2.8 ms   | 4.3 ms        | 128 ms        |
| PatternRouter                | 3.0 ms   | 4.4 ms        | 135 ms        |
| LinearRouter                 | 1.4 ms   | 0.8 ms        | 199 ms        |

SmartRouter picks a router by trying `RegExpRouter` first, and it does that on the **first request**
rather than at registration. At this scale that is around 39 ms, which is the attempt plus the
fallback, against 4 ms for either router chosen outright. The Workers free plan allows 10 ms of CPU
per request, so the first request into each new isolate can be killed with `exceededCpu`.

Skipping the attempt is what naming a router buys. Which one you may name is a property of your
spec, and the compile tells you.

### `RegExpRouter` only when the compile says so

**`RegExpRouter` refuses a static path segment beside a path parameter at the same position** -
`/users/me` next to `/users/{id}`, `/items/search` next to `/items/{id}`. That is the commonest shape
in REST, and this emitter registers concrete paths before templated ones precisely so it works.

It is not a degraded route. `RegExpRouter` throws `UnsupportedPathError` from `registerRoutes`, which
runs at module scope, so the isolate never finishes starting and every request fails. `wrangler
deploy` succeeds; the service is simply down.

So the emitter checks for you, by handing your composed routes to Hono's own `RegExpRouter` at
compile time. If `tsp compile` says nothing, a bare `RegExpRouter` is safe:

```ts
const app = new Hono<AppEnv>({ router: new RegExpRouter() });
```

If it raises `regexp-router-unsupported`, use `PatternRouter`:

```ts
import { PatternRouter } from "hono/router/pattern-router";

const app = new Hono<AppEnv>({ router: new PatternRouter() });
```

**`PatternRouter` rather than the default, and that is measured.** It mounts the route set
`RegExpRouter` refuses - `/items/plain` beside `/items/{id}` routes correctly under it - and it costs
5% more than `RegExpRouter` in steady state against `SmartRouter`'s 33%, with a first request nine
times cheaper. The default is still correct and still safe; it is simply the slowest of the three,
because trying `RegExpRouter` and falling back is what it does on the first request.

The warning names the route that conflicts. Adding one operation to a spec can turn a safe route set
into an unsafe one, so the check runs on every compile rather than once.

`LinearRouter` is the other exception: choose it for a low-traffic Worker where cold start dominates
and throughput does not. It is the cheapest to start and roughly four times slower per request.

## Bundle size

|                | raw      | gzip      | share of the 3 MB free limit |
| -------------- | -------- | --------- | ---------------------------- |
| 20 operations  | 642 KiB  | 100.8 KiB | 3.3%                         |
| 580 operations | 1008 KiB | 112.6 KiB | 3.7%                         |

560 additional operations cost around 12 KiB gzipped. The baseline is Hono and Zod rather than the size
of your API, and router choice moves it by under 1 KiB, so do not pick a router for size.

`registerRoutes` runs at module scope in 1.1-6.1 ms, inside the 1 second startup budget.

Limits are 3 MB gzipped on the free plan and 10 MB on paid.
