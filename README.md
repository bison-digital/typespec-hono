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

@error
model NotFound {
  @statusCode statusCode: 404;
  message: string;
}

@route("/widgets")
interface WidgetRoutes {
  @get list(@query limit?: int32): Widget[];
  @get read(@path id: string): Widget | NotFound;
}
```

```bash
pnpm exec tsp compile .
```

### `src/index.ts`

A handler returns `{ status, body }` for any response its operation declares, the failures included.
`input` and every declared response are known from the spec, so a handler returning a status the spec
does not declare, or the wrong body for a status, does not compile:

```ts
import { Hono } from "hono";
import { registerRoutes, type Operations } from "./generated/app.gen.js";
import { deps, type Caller } from "./deps.js";

const handlers = {
	WidgetRoutes_list: (ctx, input) => ({ status: 200, body: widgets.slice(0, input.limit ?? 20) }),
	WidgetRoutes_read: (ctx, input) => {
		const widget = widgets.find((w) => w.id === input.id);
		return widget === undefined
			? { status: 404, body: { message: `no widget ${input.id}` } }
			: { status: 200, body: widget };
	},
} satisfies Operations<Caller>;

export default registerRoutes(new Hono(), () => handlers, deps);
```

`satisfies` keeps each `status` a literal, which is what selects the response it belongs to. Without
it, `status: 404` widens to `number`, which no declared response admits.

The generated route serves each response with the Hono call for it - `c.json(body, 404)` for the
failure above - after checking the body against the schema the document publishes for that status. So
Hono's RPC client narrows a response body by its status, and a body the document does not permit
reaches `app.onError` as a `ResponseContractError` rather than a caller.

Leave the factory passed to `registerRoutes` unannotated: annotating it widens the value and disables
the check that catches a handler for an operation the spec no longer declares. It is a factory rather
than an object because a Workers service binding lives on `c.env` and exists only for the duration of
a request.

### `src/deps.ts`

Five hooks, each answering something the spec does not contain:

| hook            | the spec says                               | you say                              |
| --------------- | ------------------------------------------- | ------------------------------------ |
| `authorize`     | which schemes and scopes an operation needs | whether this caller satisfies them   |
| `context`       | whether a caller is required                | who the caller is                    |
| `noContext`     |                                             | what to answer when there is not one |
| `notAcceptable` | which media types are offered               | what to answer when none match       |
| `invalid`       | the schema                                  | what a validation failure looks like |

```ts
import type { AppEnv, RouteDeps } from "./generated/runtime.gen.js";

export interface Caller {
	readonly userId: string;
}

export const deps: RouteDeps<AppEnv, Caller> = {
	authorize: (requirements) => async (c, next) => {
		await next();
	},
	context: (c) => {
		const userId = c.req.header("x-user");
		return userId === undefined ? null : { userId };
	},
	noContext: (c) => c.json({ error: "unauthorized" }, 401),
	notAcceptable: (c, offered) => c.json({ error: "not_acceptable", offered }, 406),
	invalid: (result, c) => (result.success ? undefined : c.json({ error: "invalid" }, 400)),
};
```

Whatever `context` returns is what every handler receives as `ctx`. Your Hono environment - bindings
and variables - is an augmentation of the emitted `AppEnv`:

```ts
declare module "./generated/runtime.gen.js" {
	interface AppEnv {
		Bindings: { DB: D1Database };
		Variables: { requestId: string };
	}
}
```

Routing, request validation, the handler types and how each declared response is served come from the
spec. What is left is the four files above.

## What it emits

Into your output directory:

| file                   | what it is                                                                       |
| ---------------------- | -------------------------------------------------------------------------------- |
| `app.gen.ts`           | the server: routes, validators, what each operation may answer, and the handlers |
| `runtime.gen.ts`       | the types your `deps` implements against, and the helpers the server calls       |
| `schemas.gen.ts`       | a Zod schema for every request and response, and the status arms each declares   |
| `vocabularies.gen.ts`  | shared enums, where the spec declares them                                       |
| `requests.gen.ts`      | request types, when `contracts-output-dir` is set                                |
| `wire-contract.gen.ts` | assertions that the schemas and the types agree, with the same option            |

The last four are `typespec-http-zod`'s; see its README for what they contain.

`runtime.gen.ts` is written on every compile. Your own code imports from it and augments `AppEnv` in
it, and nothing replaces it.

Routes are grouped into a sub-app per resource and mounted with `app.route()`, following
[Hono's best-practices guide](https://hono.dev/docs/guides/best-practices). Handlers are written
directly after the path definitions rather than lifted into separate controller files, because a
handler in another file cannot infer its path parameters. A resource with a single route gets no
sub-app.

The output is plain `Hono` and `@hono/zod-validator`, not `@hono/zod-openapi`. That package generates
a document from the code, which would compete with the one openapi3 publishes from the spec. The
responses a route serves are the ones `@hono/zod-openapi` would require of it: across the conformance
corpus, what Hono's RPC client infers for 619 routes is compared with what `RouteConfigToTypedResponse`
derives from the published document.

## Docs

- [Guides](docs/guides.md): declared failures, middleware, the RPC client, authentication, base
  paths, HEAD operations, request bodies, streaming, observability, upgrading
- [Cloudflare Workers](docs/cloudflare-workers.md): which router to pick, and what the bundle costs
- [Reference](docs/reference.md): every option, every diagnostic, and the known limits
- [Releasing](docs/releasing.md): rehearsing a two-package release against a local registry,
  because the server resolves the library through npm and CI cannot verify a change spanning both

## Licence

MIT
