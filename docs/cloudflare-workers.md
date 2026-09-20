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

Measured on a generated 360-operation service (120 resources, 3 operations each), Hono 4.13.8, each
request driven end to end through `app.request` rather than through `router.match` alone. Each router
in its **own process**, warmed with 5000 discarded requests, then the median of five runs of 1000:

| router                       | register | 1000 requests | spread of 5 |
| ---------------------------- | -------- | ------------- | ----------- |
| SmartRouter (Hono's default) | 10.0 ms  | 8 ms          | 4-11 ms     |
| RegExpRouter                 | 7.8 ms   | 6 ms          | 4-7 ms      |
| TrieRouter                   | 9.6 ms   | 6 ms          | 5-9 ms      |
| PatternRouter                | 6.8 ms   | 37 ms         | 32-38 ms    |
| LinearRouter                 | 4.7 ms   | 77 ms         | 74-80 ms    |

**There is no "first request" column, because the one that used to be here measured the benchmark
rather than the router.** All four were timed in one process, so whichever ran first paid the JIT
cost of the whole Hono request path. Same harness, two orders:

```
order: SmartRouter -> RegExpRouter -> ...       order: RegExpRouter -> SmartRouter -> ...
  SmartRouter    first 22.2ms                     RegExpRouter   first 20.4ms
  RegExpRouter   first  2.8ms                     SmartRouter    first  2.1ms
```

The 20 ms follows the position, not the router. SmartRouter does try `RegExpRouter` first and does
fall back on the first request, but at this scale that cost does not survive isolation, and the
earlier claim that it risked the free plan's 10 ms CPU limit was an artifact.

What does survive is steady state, and there the default is already among the fastest: it falls back
to `TrieRouter`, which measures the same as `RegExpRouter` here. Naming a router buys little unless
you are naming it to avoid one that cannot compile your route set at all.

### `RegExpRouter` only when the compile says so

**`RegExpRouter` refuses a static path segment beside a path parameter at the same position** -
`/users/me` next to `/users/{id}`, `/items/search` next to `/items/{id}`. That is the commonest shape
in REST, and this emitter registers concrete paths before templated ones precisely so it works.

It is not a degraded route. `RegExpRouter` throws `UnsupportedPathError` from `registerRoutes`, which
runs at module scope, so the isolate never finishes starting and every request fails. `wrangler
deploy` succeeds; the service is simply down.

So the package ships a check, the `regexp-router-unsupported` linter rule, which hands your composed
routes to Hono's own `RegExpRouter` at compile time. **It is off until you enable it** - see
[Linter rules](reference.md#linter-rules) - because it is advice about a router you choose, and a
project on the default router should not hear it. **If you use `RegExpRouter`, enable it.** With the
rule on, a compile that says nothing means a bare `RegExpRouter` is safe:

```ts
const app = new Hono<AppEnv>({ router: new RegExpRouter() });
```

If it raises `regexp-router-unsupported`, use `PatternRouter`:

```ts
import { PatternRouter } from "hono/router/pattern-router";

const app = new Hono<AppEnv>({ router: new PatternRouter() });
```

**Prefer the default `new Hono()` here, and reach for `PatternRouter` only if you have measured your
own route set.** Both mount the route set `RegExpRouter` refuses - `/items/plain` beside
`/items/{id}` routes correctly under either - but on the table above `PatternRouter` costs about
**5x** `RegExpRouter` in steady state and about 4.6x the default, on hono 4.13.1 as well as 4.13.8.
An earlier version of this page said it was within 5% of `RegExpRouter`; that was wrong, and the
rule that repeated it has been corrected.

The default is not the slow option it was described as. It tries `RegExpRouter`, fails, and settles
on `TrieRouter`, which is as fast as `RegExpRouter` on this route set.

The rule names the route that conflicts. Adding one operation to a spec can turn a safe route set into
an unsafe one, so once enabled it runs on every compile rather than once.

`LinearRouter` is the other exception: choose it for a low-traffic Worker where cold start dominates
and throughput does not. It is the cheapest to register and roughly ten times slower per request than
the default on the table above.

## Bundle size

Measured with `wrangler deploy --dry-run` on hono 4.13.8 / zod 4.6.5, on generated services of
7 and 194 resources at 3 operations each:

|                | raw        | gzip      | share of the 3 MB free limit |
| -------------- | ---------- | --------- | ---------------------------- |
| 21 operations  | 871.4 KiB  | 139.6 KiB | 4.5%                         |
| 582 operations | 1325.4 KiB | 154.8 KiB | 5.0%                         |

561 additional operations cost around 15 KiB gzipped, about 27 bytes each. The baseline is Hono and
Zod rather than the size of your API, and router choice moves it by under 1 KiB, so do not pick a
router for size.

An earlier version of this page gave 642 KiB / 100.8 KiB and 1008 KiB / 112.6 KiB with no version,
date or tool recorded, and no harness in the repository. The per-operation cost it derived was about
right; the baseline was not.

`registerRoutes` runs at module scope in 4.7-10.0 ms on the 360-operation service above,
depending on the router, inside the 1 second startup budget.

Limits are 3 MB gzipped on the free plan and 10 MB on paid.
