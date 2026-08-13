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
import { RegExpRouter } from "hono/router/reg-exp-router";
import { registerRoutes } from "./generated/app.gen.js";
import { deps } from "./deps.js";
import type { AppEnv } from "./generated/runtime.gen.js";

const handlersFor = (c) => widgetsFor(c.env.DB);

const app = new Hono<AppEnv>({ router: new RegExpRouter() });
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

Hono ships four routers and you choose one when you construct the app. The default is a poor fit for a
generated server, so this is worth two minutes.

Measured on a generated 580-operation service (58 resources, 10 operations each), three runs, Hono
4.13.1:

| router                       | register   | first request | 1000 requests |
| ---------------------------- | ---------- | ------------- | ------------- |
| SmartRouter (Hono's default) | 5.4-6.1 ms | 18.5-18.9 ms  | 24-26 ms      |
| RegExpRouter                 | 2.6-4.4 ms | 2.2-2.6 ms    | 16-18 ms      |
| LinearRouter                 | 1.1-1.2 ms | 0.6 ms        | 66-70 ms      |
| PatternRouter                | 2.7-2.9 ms | 2.5 ms        | 36-39 ms      |

SmartRouter chooses a router by trying one, and it does that on the **first request** rather than at
registration. At this scale that is around 18.8 ms of CPU. The Workers free plan allows 10 ms of CPU
per request, so the first request into each new isolate can be killed with `exceededCpu`.

**Use `RegExpRouter`.** It registers in under 5 ms at 580 operations and is the fastest in steady
state. Its reputation for slow registration comes from applications that register routes lazily; a
generated server registers everything once, at module scope.

`LinearRouter` is the exception: choose it for a low-traffic Worker where cold start dominates and
throughput does not. It is the cheapest to start and roughly four times slower per request.

## Bundle size

|                | raw      | gzip      | share of the 3 MB free limit |
| -------------- | -------- | --------- | ---------------------------- |
| 20 operations  | 642 KiB  | 100.8 KiB | 3.3%                         |
| 580 operations | 1008 KiB | 112.6 KiB | 3.7%                         |

560 additional operations cost around 12 KiB gzipped. The baseline is Hono and Zod rather than the size
of your API, and router choice moves it by under 1 KiB, so do not pick a router for size.

`registerRoutes` runs at module scope in 1.1-6.1 ms, inside the 1 second startup budget.

Limits are 3 MB gzipped on the free plan and 10 MB on paid.
