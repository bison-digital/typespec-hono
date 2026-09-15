# Reference

## Options

Every option `typespec-http-zod` accepts is forwarded, and the schema is derived from that package's
rather than restated. See its README for `seal-object-schemas`, `contracts-output-dir`,
`contracts-package`, `compile-schemas`, `key-vocabularies`, `regenerate-hint` and `services`.
`runtime-module` is refused; see below.

`compile-schemas` is worth a word here because a SERVER is where it pays. It wraps every emitted
validator in Zod 4.5's `z.compile()`, and a generated server parses on the synchronous path - the
only path the compiled fast path is available on, since Zod bypasses it for any async parse. It costs
startup time in proportion to the number of schemas, so it is off by default.

**On Cloudflare Workers it is the only route to a compiled schema.** `new Function` is permitted
during a Worker's STARTUP phase, which is when module scope runs, whereas Zod's own
`import "zod/compile"` compiles lazily on first parse - inside a request, where the runtime refuses
it, silently. Both measured on `workerd`, and a generated server with the option on reports a live
compiled fast path while serving.

`regenerate-hint` is worth setting on day one: it writes your project's own regeneration command into
every generated banner, so a reader who opens one is told what to run rather than only what not to
edit.

**`runtime-module` is refused with `runtime-module-removed`, an error.** It used to replace
`runtime.gen.ts` with an application's own module, and that made the application own a copy of
generated logic - content negotiation, the HEAD guard, response selection - which aged: a gateway ran
the `0.10.1` runtime while this emitter reached `0.21.0`, carrying a negotiation defect fixed long
before. The option is still in the schema so that setting it reports what to do instead, rather than
"must NOT have additional properties". `runtime.gen.ts` is written on every compile.

What the option was used for has a place of its own:

| a substituted module declared | now                                                                         |
| ----------------------------- | --------------------------------------------------------------------------- |
| `Ctx`                         | inferred by `registerRoutes` from what `deps.context` returns               |
| `AppEnv`                      | `declare module "./generated/runtime.gen.js" { interface AppEnv { ... } }`  |
| `Result<T>`                   | the union of the responses each operation declares, generated per operation |
| `RouteDeps`                   | `RouteDeps<AppEnv, Caller>`, parameterised by your caller context           |

**What the generated files import from `runtime.gen.ts` is a closed list**, asserted by
`test/adopter.test.ts`: the types `AppEnv`, `Awaitable`, `RouteDeps` and `ResponseArm`, and the
helpers `servedBody`, `headersOf`, `UndeclaredStatusError`, `selectContentType` and `headOnly`, each
emitted only where a route uses it.

**`selectContentType` is emitted only where several operations share one route.** The generated
server imports it when some route group has more than one member, which is what a route serving
several media types looks like. A spec with no such route never imports it, so a consumer reading a
negotiation fix can tell whether it reached them: if `selectContentType` does not appear in your
`app.gen.ts`, it did not.

## What it refuses, and why

| code                              | why                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unvalidatable-media-type`        | The document declares a request media type no `zValidator` target can parse, most commonly `application/xml`. The route is still mounted and still validates every type that can be parsed, chosen from the request's `Content-Type`. Requests carrying the others are refused rather than parsed as something they are not. |
| `unsupported-path-template`       | A path parameter whose wire name carries a character Hono cannot hold in a route parameter: a space, `+` or `!`. Reachable only through `@path("...")` with a non-identifier wire name. The route is registered at the literal template, so it matches nothing rather than matching the wrong requests.                      |
| `unvalidated-response-media-type` | A response declares a model under a media type that is not JSON, most commonly `application/xml`. No serialisation derives from the schema, so the handler returns that body as a string and the route serves it without validating it. Every other response on the operation is validated as usual.                         |
| `runtime-module-removed`          | `runtime-module` is set. It is an error: the option is ignored and `runtime.gen.ts` is emitted, because an application that substituted the runtime owned a copy of generated logic. See [Upgrading](guides.md#upgrading).                                                                                                   |

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
- **XML response bodies are not validated either.** A model declared under `application/xml` is
  served as the text the handler supplies, and `unvalidated-response-media-type` names each one.
- **A scalar JSON request body does not compile.** `@body body: string`, an enum or a union is spread
  into the handler's input as though it were an object, `TS2698`. Five corpus scenarios carry one, and
  `test/conformance/typecheck.test.ts` lists them. A recursive dictionary body has a related defect,
  `TS2322`, in a sixth.
- **Middleware responses are not part of a route's type.** `noContext`, `invalid` and `notAcceptable`
  answer from middleware, which is also where `@hono/zod-openapi` leaves them, so Hono's RPC client
  does not see their bodies.
- **`int64` and `uint64` are validated as JavaScript numbers**, so values above 2^53-1 are refused.
  Above that point an integer is not uniquely representable as a JavaScript number, so a validator
  cannot certify that the value it holds is the value that was sent. Use `@encode(string)`, which is
  TypeSpec's own remedy and which this emitter renders as `z.string()`.
- **`app.on(method, ...)` is not reachable from any current TypeSpec spec**, because `@typespec/http`
  declares six verbs and five have dedicated Hono helpers. The branch is exercised directly by
  `test/render.test.ts` rather than deleted, so a verb TypeSpec adds later does not emit
  `app.undefined(...)`.

## Coverage

Graded against 62 scenarios of [`@typespec/http-specs`](https://github.com/microsoft/typespec), a
corpus this project did not write, with route counts read from `app.routes` after mounting the real
server rather than from the emitted text: 635 declared, 635 mounted, 0 refused, 27 partially
validated, and 29 responses served unvalidated as XML.

Every emitted server is compiled under `strict`, `exactOptionalPropertyTypes` and `noUnusedLocals`,
and for 619 routes what Hono's RPC client infers is compared with what `@hono/zod-openapi`'s
`RouteConfigToTypedResponse` derives from the published document.

## Path parameters that carry slashes

A hierarchical identifier is one value, not several segments: an Obsidian note is `areas/health.md`,
and an S3 key or a GitHub file path is the same shape. Declare it with RFC 6570 reserved expansion in
the route template:

```tsp
@route("/vault/{+path}")
@get
op readNote(@path path: string): Note;
```

The route is mounted as `/vault/:path{.+}`, so the whole remainder reaches the handler. A parameter
without the marker is unchanged and still matches a single segment.

**The published document says `/vault/{path}`, and that is a divergence we accept deliberately.**
OpenAPI cannot express reserved expansion at any version, including 3.2, so `@typespec/openapi3`
strips the operator and raises `path-reserved-expansion` as a warning. Suppress it per operation if
you do not want it in your build output.

The divergence is a **superset rather than a contradiction**, which is what makes it safe: a client
generated from the document percent-encodes a path parameter and sends `/vault/areas%2Fhealth.md`,
and the greedy route answers that too, with the same value. Measured both ways in `test/wire/`, which
is the only oracle available here, since the document deliberately disagrees and cannot be compared
against.

**Two parameters in one route are independent.** `@route("/repo/{owner}/{+ref}")` mounts
`/repo/:owner/:ref{.+}`: `owner` still matches one segment.

## Not serving a service you compile

An internal surface and a public one belong in one `tsp compile`, which is what makes a shared
vocabulary shared. A project that does not serve one of them yet still wants its types and its
validators, and used to get a server as well:

```yaml
options:
  typespec-hono:
    services:
      Unserved:
        emit-server: false
```

Only `app.gen.ts` is withheld. Everything the library emits for that service is untouched, because
those are the reason it is in the program.
