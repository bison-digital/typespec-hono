# Reference

## Options

Every option `typespec-http-zod` accepts is forwarded, and the schema is derived from that package's
rather than restated. See its README for `seal-object-schemas`, `contracts-output-dir`,
`contracts-package`, `key-vocabularies`, `runtime-module` and `services`.

`runtime-module` is the one to reach for when the identity defaults are not enough. Point it at a
module of your own that re-declares `Result`, `Ctx`, `AppEnv` and `RouteDeps`, and every generated
signature carries your types. Setting it also stops `runtime.gen.ts` being written, since your module
replaces it; that module has to export every name the generated files reference, which is what
`runtime.gen.ts` is a working example of.

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

Graded against 61 scenarios of [`@typespec/http-specs`](https://github.com/microsoft/typespec), a
corpus this project did not write, with route counts read from `app.routes` after mounting the real
server rather than from the emitted text: 577 declared, 577 mounted, 0 refused, 27 partially
validated.
