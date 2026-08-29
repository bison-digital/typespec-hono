# Reference

## Options

Every option `typespec-http-zod` accepts is forwarded, and the schema is derived from that package's
rather than restated. See its README for `seal-object-schemas`, `contracts-output-dir`,
`contracts-package`, `key-vocabularies`, `runtime-module`, `regenerate-hint` and `services`.

`regenerate-hint` is worth setting on day one: it writes your project's own regeneration command into
every generated banner, so a reader who opens one is told what to run rather than only what not to
edit.

`runtime-module` is the one to reach for when the identity defaults are not enough. Point it at a
module of your own that re-declares `Result`, `Ctx`, `AppEnv` and `RouteDeps`, and every generated
signature carries your types. Setting it also stops `runtime.gen.ts` being written, since your module
replaces it; that module has to export every name the generated files reference, which is what
`runtime.gen.ts` is a working example of.

**That list of names is a contract, and it is deliberately small.** Everything the generated files
import from your module is something you have to supply, so the set is kept to what only an
application can answer - its environment, its caller context, its result envelope, its hooks - plus
the two helpers that implement a published rule rather than a policy (`selectContentType` implements
RFC 9110's content negotiation; `headOnly` implements what a `HEAD`-only route answers). Request-body
validation is emitted into `app.gen.ts` instead: it is pure mechanism with no application types in
it, and putting it here would have made every substituting application implement body parsing to get
a correct error envelope. `test/adopter.test.ts` asserts the set as a closed list.

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

## Coverage

Graded against 62 scenarios of [`@typespec/http-specs`](https://github.com/microsoft/typespec), a
corpus this project did not write, with route counts read from `app.routes` after mounting the real
server rather than from the emitted text: 635 declared, 635 mounted, 0 refused, 27 partially
validated.

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
