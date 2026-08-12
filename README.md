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

The server is **plain `Hono` and `@hono/zod-validator`**, deliberately not `@hono/zod-openapi`. That
package is the same validation plus a document generated FROM the code — spec-last, and a second
source of truth competing with the one openapi3 publishes from the spec. We want its validation, not
its documentation.

```ts
import { Hono } from "hono";
import { registerRoutes } from "./generated/app.gen.js";

const app = new Hono<AppEnv>();
// ⚠️ Unannotated on purpose — annotating widens the value and disables the exhaustiveness check.
const handlersFor = (c) => backendFor(c.env);
registerRoutes(app, handlersFor, deps);
```

`handlersFor` is a **factory** rather than an object because in Workers a service binding lives on
`c.env` and exists only for the duration of a request — there is no module scope in which
`backendFor(env)` can be resolved.

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
- **`app.on(method, …)` is reachable in principle and exercised by nothing.** It exists for a verb
  Hono has no dedicated helper for. `@typespec/http` declares exactly six verbs, five have helpers,
  and the sixth is `@head`, which is refused — so no spec can currently reach that branch.

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
