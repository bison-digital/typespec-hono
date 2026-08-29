# typespec-hono

Generate a [Hono](https://hono.dev) server from a TypeSpec API definition. Routing, request
validation and handler types all come from the spec.

Add [`@typespec/openapi3`](https://typespec.io) to the same config and it writes the OpenAPI document
from that same definition, so your server and your docs cannot drift apart.

Validation and types come from
[`typespec-http-zod`](https://github.com/bison-digital/typespec-http-zod), which this runs for you, so
your config lists one emitter.

## Install

```bash
pnpm add -D typespec-hono
```

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

## Quick start

You write four files. Everything under `src/generated/` is produced by the compiler and never edited:

```
main.tsp              your API definition
tspconfig.yaml        which emitters to run
src/
  generated/          written by `tsp compile`, never edited by hand
    app.gen.ts
    runtime.gen.ts
    schemas.gen.ts
  deps.ts             your application's answers
  index.ts            your handlers, and the app
```

### `main.tsp`

```tsp
import "@typespec/http";
using Http;

@service(#{ title: "Widgets" })
namespace Widgets;

model Widget {
  id: string;
  name: string;
}

@route("/widgets")
interface WidgetRoutes {
  @get list(@query limit?: int32): Widget[];
  @get read(@path id: string): Widget;
}
```

```bash
pnpm exec tsp compile .
```

### `src/index.ts`

`input` and the return type are both known from the spec, so a handler that does not match the
contract does not compile:

```ts
import { Hono } from "hono";
import { registerRoutes } from "./generated/app.gen.js";
import { deps } from "./deps.js";

const handlersFor = () => ({
	WidgetRoutes_list: (ctx, input) => widgets.slice(0, input.limit ?? 20),
	WidgetRoutes_read: (ctx, input) => widgets.find((w) => w.id === input.id),
});

export default registerRoutes(new Hono(), handlersFor, deps);
```

Leave `handlersFor` unannotated: annotating it widens the value and disables the check that catches a
handler for an operation the spec no longer declares. It is a factory rather than an object because a
Workers service binding lives on `c.env` and exists only for the duration of a request.

### `src/deps.ts`

Six hooks, each answering something the spec does not contain:

| hook            | the spec says                               | you say                              |
| --------------- | ------------------------------------------- | ------------------------------------ |
| `authorize`     | which schemes and scopes an operation needs | whether this caller satisfies them   |
| `context`       | whether a caller is required                | who the caller is                    |
| `noContext`     |                                             | what to answer when there is not one |
| `notAcceptable` | which media types are offered               | what to answer when none match       |
| `invalid`       | the schema                                  | what a validation failure looks like |
| `respond`       | every status arm and its schema             | which arm this result is             |

```ts
import type { RouteDeps } from "./generated/runtime.gen.js";

export const deps: RouteDeps = {
	authorize: (requirements) => async (c, next) => {
		await next();
	},
	context: (c) => ({ userId: c.req.header("x-user") }),
	noContext: (c) => c.json({ error: "unauthorized" }, 401),
	notAcceptable: (c, offered) => c.json({ error: "not_acceptable", offered }, 406),
	invalid: (result, c) => (result.success ? undefined : c.json({ error: "invalid" }, 400)),
	respond: (c, arms, result) => c.json(result as never, 200),
};
```

Routing, request validation and the handler types come from the spec. What is left is the four files
above.

## What it emits

Into your output directory:

| file                   | what it is                                                                     |
| ---------------------- | ------------------------------------------------------------------------------ |
| `app.gen.ts`           | the server: routes, validators, and the handler interface you implement        |
| `runtime.gen.ts`       | the types your `deps` implements against, and the helpers the server calls     |
| `schemas.gen.ts`       | a Zod schema for every request and response, and the status arms each declares |
| `vocabularies.gen.ts`  | shared enums, where the spec declares them                                     |
| `requests.gen.ts`      | request types, when `contracts-output-dir` is set                              |
| `wire-contract.gen.ts` | assertions that the schemas and the types agree, with the same option          |

The last four are `typespec-http-zod`'s; see its README for what they contain.

Your own code imports from `runtime.gen.ts`:

```ts
import type { Ctx, RouteDeps } from "./generated/runtime.gen.js";
```

Setting `runtime-module` replaces it with a module of your own, and it is then not written.

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

## Docs

- [Guides](docs/guides.md): middleware, the RPC client, authentication, base paths, HEAD operations,
  request bodies, streaming, observability
- [Cloudflare Workers](docs/cloudflare-workers.md): which router to pick, and what the bundle costs
- [Reference](docs/reference.md): every option, every diagnostic, and the known limits
- [Releasing](docs/releasing.md): rehearsing a two-package release against a local registry,
  because the server resolves the library through npm and CI cannot verify a change spanning both

## Licence

MIT
