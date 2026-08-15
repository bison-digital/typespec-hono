# Changelog

All notable changes to `typespec-hono` are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**At `0.x` the public API is not frozen.** A minor bump may change the emitted output or the
published types; a patch will not. The **emitted output is part of the API**, a change to what
`registerRoutes` returns, to a validator's shape, or to what a handler receives is a change a
consumer feels, and is treated as such here rather than as an implementation detail.

## [Unreleased]

Nothing since `0.20.0`.

## [0.20.0] - 2026-08-15

Requires `typespec-http-zod@^0.22.0`.

### Fixed

- **A handler can now say which success status it means, and set a declared response header.** Both
  are published in the emitted arms and neither could be reached: `@statusCode` and `@header` are
  stripped from the body schema - correctly, they are not body - so a return type derived from that
  schema alone could not carry them, while the arms named them anyway. Measured on `payload__head`:

      contentTypeHeaderInResponse(ctx, input): Awaitable<Result<void>>
      ...Responses = [{ status: 200, schema: undefined,
                        headers: [{ name: "Content-Type", property: "contentType" }, ...] }]

  `respond` was instructed to read `contentType` off a value typed `void`. The return type is now the
  body view intersected with the envelope the arms ask for - the `@statusCode` union where the spec
  declares one, and each declared response header with its own type rather than a guessed `string`.

  `test/envelope/` sends real requests: a handler returning `statusCode: 201` gets a **201**, one
  returning `200` gets a **200**, and a header the arm names reaches the response. Asserting the
  signature mentions `statusCode` would have passed for a server that still answers 200 to
  everything.

### Changed

- `test/path-template.test.ts`'s fixture no longer omits fields behind `as unknown as`. It did, and a
  field added to `EmittedRoute` turned eight path arms red with
  `Cannot read properties of undefined` - a failure about nothing to do with paths.

## [0.19.1] - 2026-08-15

Requires `typespec-http-zod@^0.21.0`, which stops writing an unused `Simplify<T>` into the contract
types of a service that has nothing to flatten - `TS6196` under `noUnusedLocals`, on the two
parameterless `GET`s every new consumer starts with.

**A dependency bump on its own, because a caret on a `0.x` version pins the minor**: without this
release the library fix cannot reach anyone using this package.

## [0.19.0] - 2026-08-15

Requires `typespec-http-zod@^0.20.0`. Three findings from `agent-books` (~260 operations ported).
All three reproduced; none was covered by either suite.

### Fixed

- **An EMPTY request model made the generated server fail to compile.** Zod 4 infers
  `Record<string, never>` for `z.object({})`, so `{ id: string } & Record<string, never>` turned `id`
  into `string & never` - `TS2345`, inside `app.gen.ts` itself. Each intersected member now passes
  through `Fields<>`, which maps an empty validator to `unknown`, the identity of `&`. A dictionary
  body is untouched: it has a value type, so it is not empty.

- **A streamed upload is handed over unread.** A binary body was read with `await c.req.arrayBuffer()`
  before the handler ran. A Worker isolate is 128 MB against a request-body limit of 100 MB, so an
  upload at the documented maximum could not be served at all - and the document publishes only
  `contentMediaType` for such a body, so **nothing about it was validated either**: the whole cost of
  reading it bought a value nothing checked. The handler now receives `c.req.raw.body` as
  `ReadableStream<Uint8Array> | null` and pipes it wherever it likes.

  **This costs no ambient dependency**, which was assumed to be a trade and then measured: the
  generated server has named `Response` since it was first emitted, so whatever a project already
  supplies to satisfy that declares `ReadableStream` too. `test/streambody/` asserts both halves.

  A raw JSON body is still read with `text()`, which a signature check needs verbatim.

- **An OPTIONAL body no longer refuses a request that carries none.** `@body body?:` mounted
  `zValidator` unconditionally, so a bodyless `POST` naming `content-type: application/json` answered
  400 `Malformed JSON in request body` as `text/plain` - outside the app's error envelope, because
  `zValidator` raises before `deps.invalid` runs. Such a body is now named `body?:` on the input and
  mounted by a new `optionalBody` middleware, so an absent body reads `undefined` and the handler is
  told the truth rather than handed an invented empty object.

- **A malformed body now reports through `deps.invalid`** for optional and multi-media-type bodies,
  so the app's envelope holds. See the known limit below for the case that remains.

### Known limit

A **required, single-media-type** body still rejects malformed JSON through `zValidator`'s
`HTTPException`, which is `text/plain` and escapes `deps.invalid`. Routing it through the same
middleware was implemented and reverted: it is a breaking change to the RUNTIME CONTRACT rather than
to emitted output, because an app substituting `runtime-module` would have to export `byContentType`,
which today it needs only for the rare multi-media-type case. Measured, 15 arms red. Closing it wants
a form that adds no export - most likely emitting the middleware into `app.gen.ts` itself.

## [0.18.1] - 2026-08-15

### Fixed

- **A property whose declared type is a dictionary was flattened in a handler's return type.**
  `Produced<>` strips index signatures so an open model's `.loose()` catchall does not become an
  obligation on the handler; it recursed into every object, so a property declared `Record<unknown>`
  - where the index signature IS the type - lost it and became `{}`. Same defect as
    `typespec-http-zod@0.19.1`, at this package's boundary, and fixed the same way: the index signature
    is dropped only from a shape with declared keys beside it.

Requires `typespec-http-zod@^0.19.1`.

## [0.18.0] - 2026-08-15

Requires `typespec-http-zod@^0.19.0`. Two changes to the signature a handler is written against,
both from consumer reports.

### Changed

- **Every operation now takes `(ctx, input)`, including one that declares no input**, which gets
  `Record<string, never>`. A surface written once against `Operations` - an RPC entrypoint, a proxy,
  any uniform dispatch - is typed `(ctx, input)`, and TypeScript refuses a function with MORE
  parameters than the signature it is assigned to, so a single parameterless operation made the whole
  surface unassignable: `TS2322: Target signature provides too few arguments. Expected 2 or more, but
got 1.`

  **This breaks nothing.** Fewer parameters is always assignable, so a handler already written
  `(ctx) => ...` keeps compiling untouched, and `test/openmodel/treaty.test.ts` holds both halves so
  that stays true.

- **A handler can return an immutable view.** The return type is now the producer's view: `readonly`
  as well as index-signature-free, at every depth. `readonly T[]` and `T[]` serialise to identical
  bytes, so mutability is a TypeScript variance property rather than a wire property - which
  `Produced<>` in the contract types had said all along while the handler signature did not honour
  it. Measured on one service: 2 contract methods returning `readonly T[]` could not be wired at all.

  **An explicit `undefined` on an optional property is deliberately still accepted.** Removing it was
  implemented and reverted: it looks like the same class and is the opposite. Dropping an index
  signature or adding `readonly` makes MORE values assignable; removing `| undefined` makes fewer,
  and it broke `(ctx, input) => ok(input)` - return what you were given - because what a handler
  receives carries it.

## [0.17.0] - 2026-08-15

Requires `typespec-http-zod@^0.18.0`, which types a `HttpPart<File>` as a file instead of `unknown`.

### Changed

- **A handler reads a multipart file part without a cast.** `input.file.name`, `input.file.type` and
  `input.file.arrayBuffer()` are all reachable, for a required part, an optional one and a repeated
  one. No source change was needed here - the narrowing survives the walk that builds a handler's
  input type - but `test/filepart/` asserts it at the boundary rather than inferring it from the
  library being correct. The open-model fix in `0.15.0` did NOT survive that walk, which is why the
  claim is made here and not assumed.

  The part type is spelled structurally, so the consumer arm compiles under `types: []`: reading a
  file part pulls in no `lib.dom` and no `@types/node`.

- **`test/vocabulary.test.ts` admits that one `.refine` as a SHAPE**, with its own non-vacuity floor.
  Duplicated from the library's copy deliberately: that package emits the schema, this one embeds it
  in a server, and each grades the output it produces. A rule enforced in one place only is a rule
  the other can drift away from.

## [0.16.0] - 2026-08-15

An idiomatic review of `src/runtime.ts`, which had never had one. **`selectContentType` was wrong in
four ways and had no behavioural test at all** - `compiles.test.ts` asserted that the string
`selectContentType(` appears in emitted output, which is a claim that negotiation is wired, not that
it is correct. It ships in the runtime every consumer imports, so all four were live.

### Fixed

- **A media type the caller explicitly refused could be served.** `Accept: */*, application/json;q=0`
  chose `application/json`. `q=0` is a refusal, and it must never lose to a wildcard that accepts.
- **A type's quality was read from the best-scoring matching range rather than the most specific
  one.** RFC 9110 section 12.5.1 says specificity SELECTS which rule applies, before quality is
  compared; it was implemented as a tie-break. So `Accept: */*;q=1.0, application/json;q=0.1` served
  JSON, when the caller had pinned JSON to 0.1 and everything else to 1.0.
- **An exact type lost to a subtype wildcard** for the same reason:
  `Accept: text/*;q=0.9, text/plain;q=0.1` served `text/plain`.
- **A malformed `q` made the type unacceptable**, so `q=1.2.3` answered 406. It is now ignored, as an
  unstated `q` is: a typo in a request header should not fail negotiation.

  The docblock stated all of these rules correctly the whole time. Nothing compared it to the code,
  which is what `test/negotiation.test.ts` now does - 11 arms, every one of the four proven red first.

### Changed

- **`byContentType`'s `branches` parameter is a non-empty tuple.** The fallback reads `branches[0]`,
  which on a plain array is `T | undefined` and was silenced with a cast. The type now states what
  the emitter already guarantees, and the cast is gone rather than typed around.
- A stale docblock in `byContentType` described an implementation using Hono's `validator` that had
  already been replaced, including behaviour the current code does not have.

## [0.15.0] - 2026-08-15

Requires `typespec-http-zod@^0.17.0`, which takes the index signature off an open model's contract
type. **That fix did not reach this package on its own**, and the arm below is why we know.

### Fixed

- **A handler could not return a value the application already held.** The generated signature is
  `Awaitable<Result<z.infer<typeof xSchema>>>` - derived from the validator, not from the contract
  types - so for an open model it carried `[key: string]: unknown` at every level of the tree.
  TypeScript gives an `interface` no implicit index signature, so returning one meant spreading every
  level; on one real service that was a structural deep copy per response. The return type now drops
  index signatures at every depth.

  **The input type deliberately still carries them.** A handler RECEIVES whatever the validator let
  through, and a loose model really does pass unknown keys along, so saying so describes the value in
  hand. Producing and receiving are different directions and the two types now say different things,
  which is the point.

### Added

- `test/openmodel/` compiles a hand-written handler against the generated `Operations` interface and
  requires a plain nested `interface` to be returnable **with no spread at any level**, plus its
  mirror: that an open input is still typed as carrying unknown keys. Nothing here previously asked
  whether a handler could satisfy the signature it is written against, which is how a library-side
  fix could have been reported as complete while this boundary was still broken.

## [0.14.0] - 2026-08-14

Requires `typespec-http-zod@^0.16.0`, where two constructs made the emitter's own assertion fail on
its own output: a `@multipartBody` never reached the request type, and an open model's type lacked
the catchall its `.loose()` schema infers. Both emitted a `wire-contract.gen.ts` that does not
compile.

## [0.13.1] - 2026-08-14

`0.13.0` fixed the `Record` body for a JSON body only. **A form body validates under the `"form"`
target, not `"json"`**, and the fix keyed on the JSON target, so
`@header contentType: "application/x-www-form-urlencoded"` with a `Record` body still emitted the
intersection and still failed with `TS2345`.

The body validator is identified by its SCHEMA now, which is the same fact whichever parser reads it.

Found by compiling the reported spec from a clean install of `0.13.0`, not by the suite - the fixture
declared a JSON body only, so the form path was ungraded. It is covered now.

## [0.13.0] - 2026-08-14

Requires `typespec-http-zod@^0.15.0`.

A minor: a request body with an indexer is named in the handler's input rather than spread into it.

**A `Record` body beside any other parameter emitted a server that does not compile.** Intersected,
the body's index signature is imposed on every sibling, so
`op x(@query q?: string, @body body: Record<string>)` failed with
`TS2345: 'q' is incompatible with index signature`. The handler now receives
`{ q?: string } & { body: Record<string, string> }`, and the call site assigns the body rather than
spreading it.

**It was wrong before it failed to compile.** The document states the parameters and the body as
separate things; merged, a body key named `q` silently overwrote the query parameter of that name.
An ordinary model body is spread exactly as before.

## [0.12.0] - 2026-08-14

Requires `typespec-http-zod@^0.14.0`, where every response arm now carries its media types including
where a status offers only one. A `text/plain` arm and a JSON arm were previously indistinguishable
to a generic `deps.respond`.

## [0.11.0] - 2026-08-14

Requires `typespec-http-zod@^0.13.0`.

A minor, from the library: a scalar the spec declares is now checked rather than validated as a bare
string. `utcDateTime` emits `z.iso.datetime({ offset: true })`, `url` emits `z.url()`, and the
`plainDate`, `plainTime` and `duration` scalars likewise.

A service promising a timestamp accepted `banana` before this. `@format("...")` on a plain string
stays unenforced, because a type is a claim about the value and an annotation is a hint about it.

## [0.10.1] - 2026-08-14

A patch: `regenerate-hint` reached three generated files out of five.

The option is the library's and its files honoured it, while `app.gen.ts` and `runtime.gen.ts` are
written here and carried their own banner. A consumer set one option and got it on the two files a
reader opens last, which is worse than not offering it.

Also carries `typespec-http-zod@0.12.1`, where a redirect emitted a duplicate response arm.

Both were found by compiling a spec from a clean install of the published packages, not by either
suite. Both suites were green over them.

## [0.10.0] - 2026-08-14

Requires `typespec-http-zod@^0.12.0`.

A minor: the emitted type of every optional property changes, from the library.

### Added

- **`services.<name>.emit-server: false`**, so a service a project compiles but does not serve gets
  its types and validators without a server. An internal surface and a public one belong in one
  compile, which is what makes a shared vocabulary shared; a project not yet serving one of them used
  to get an `app.gen.ts` it kept honest with probe tests and never mounted. Only that file is withheld.
- `regenerate-hint`, forwarded from the library, writes your own regeneration command into every
  banner. Worth setting on day one: a reader who opens a generated file is then told what to run
  rather than only what not to edit.

### Fixed

- **The compile arm had never seen multi-service output.** It included `./*.gen.ts`, and a program
  declaring several services writes one directory per service, so `tsc` answered `TS18003` on the
  first such fixture rather than compiling anything. Recursive now, and the construct sweep beside it
  walks for `app.gen.ts` at any depth instead of reading only the top level.

### From the library

- An optional property is no longer typed as admitting an explicit `undefined`. JSON cannot carry
  one, and the document says so by leaving the property out of `required`.

## [0.9.1] - 2026-08-14

`0.9.0` was tagged and never published: a test fixture constructing an `EmittedRoute` by hand had not
been given the library's two new fields, so `typecheck` failed and the release workflow stopped. The
mistake that let it be tagged was piping `pnpm typecheck` into `tail`, which reports the exit status
of `tail` rather than of the compiler, so the gate chain continued past a failure.

Nothing else differs from `0.9.0`.

## [0.9.0] - 2026-08-14

Requires `typespec-http-zod@^0.11.0`.

A minor, and everything in it comes from the library: a response arm now carries the headers and the
media types the document declares for it, and an operation whose only response is a redirect is
emitted rather than silently dropped.

`ResponseArm` in the emitted runtime gains `headers` and `contentTypes` to match, so `deps.respond`
can set a `Location` on a 302 and can tell which media type it is answering with. Both are absent
where the document declares nothing, so "none declared" and "none carried" are one state rather than
two.

**If you have copied `runtime.gen.ts` to substitute your own types, take the new one.** The
declaration is structural and `test/runtime-parity.test.ts` compares this copy against the library's,
so a stale copy is a silent disagreement about what an arm carries.

## [0.8.0] - 2026-08-14

Requires `typespec-http-zod@^0.10.0`.

A minor: a spec declaring reserved path expansion mounts a different route than it did.

### A path parameter can carry slashes

A hierarchical identifier is one value, not several segments. Declare it with RFC 6570 reserved
expansion in the route template and the whole remainder reaches the handler:

```tsp
@route("/vault/{+path}")
@get
op readNote(@path path: string): Note;
```

mounts `/vault/:path{.+}`, so `GET /vault/areas/health.md` delivers `areas/health.md` rather than
`areas`. A parameter without the marker is unchanged and still matches a single segment.

**The document says `/vault/{path}` and that divergence is deliberate.** OpenAPI cannot express
reserved expansion at any version including 3.2, so `@typespec/openapi3` strips the operator and warns.
It is a superset rather than a contradiction, which is what makes it safe: a client generated from the
document percent-encodes the parameter and sends `/vault/areas%2Fhealth.md`, and the greedy route
answers that too with the same value. Both are asserted by request in `test/wire/`, which is the only
oracle available where the document deliberately disagrees.

The refusal on a parameter NAME is unchanged and still comes first: a name carrying a space, `+` or
`!` is refused whether or not it is reserved.

### Fixed

- **A comparator rejected a legal route.** The arm asserting no route is mounted at an unconverted
  template matched any registered path containing `{`, and Hono's greedy form `:name{.+}` contains one.
  It had never fired only because the corpus scenario that would reach it is skipped for an unrelated
  reason. It is about unconverted templates now rather than about braces, with its own control proving
  it still catches a real `/things/{thing-id}`.
- **The security comparator passed over zero comparisons.** It collects divergences and asserts the
  list is empty, and finding none is what happens when it reads nothing at all. Floored on both sides
  of the read, documents found and operations compared.

## [0.7.0] - 2026-08-14

Requires `typespec-http-zod@^0.9.0`.

A minor because emitted output changes: a file that needs no validator no longer imports one.

Every fix here was found by compiling generated output or by reading every generated file for a name
declared twice. None was visible to a comparison against the document, because in each case the
document was right and the emitted file was what did not build.

### Fixed

- **A service declaring no parameters emitted an import nothing used.**
  `import { zValidator } from "@hono/zod-validator"` was written unconditionally while the three
  imports beside it were already conditional, and the comment above them stated the rule this one
  broke. Two bare `GET`s, which is where a health check starts and therefore where a new consumer
  starts, failed with `TS6133: 'zValidator' is declared but its value is never read`. Reported by the
  copal-gateway migration.
- **A service whose every operation returns `void` did the same with `import { z } from "zod"`.**
  Reported in the same message as an untested hypothesis, and confirmed by measurement.
- **Operations resolving to one operation id no longer collide.** Two interfaces of the same name in
  different namespaces both resolved to `Standard_primitive`, and every declaration keyed on the id
  was emitted twice: 36 `TS2300`s on one conformance scenario. The library now deduplicates exactly as
  `@typespec/openapi3` does, so this emitter receives distinct ids.

### Added

- **`compiles.test.ts` compiles every fixture's generated output**, discovered rather than listed,
  with `noUnusedLocals` and `noUnusedParameters` on. Only one shape of `app.gen.ts` had ever been
  through a compiler, so an emitter that succeeds and emits something unbuildable was invisible.
- **`uniqueness.test.ts` reads every generated file** across every fixture and the whole conformance
  corpus for a name declared twice. It found a second collision class on its first run.
- Fixtures for the shapes those arms needed: a dispatched request body, a `HEAD` alone on its path,
  identifiers containing `$`, a service with no parameters, and one returning only `void`.

## [0.6.0] - 2026-08-14

Requires `typespec-http-zod@^0.6.0`.

A minor because the library gains a wire decoder a parameter did not have, so a
consumer regenerating gets different output.

### A name containing `$` no longer emits a file that cannot compile

TypeSpec permits `$` in a model or operation name. The check deciding which
validator identifiers to import built a regular expression per name, and `$`
anchors the end of a pattern, so `\blist$ItemsQuery\b` never matched. Escaping
alone would not have fixed it either: `\b` is a word boundary and `$` is not a
word character.

Measured on `op list$Items(@query $select?: string): Item$Ref[]`, the whole
`./schemas.gen.js` import was dropped and the emitted file failed with four
`TS2304: Cannot find name`, while `tsp compile` reported success. The rendered
text is tokenised and compared by equality now.

### From the library, via `^0.6.0`

A query or path parameter typed as a union of literals, such as
`@query size: 10 | 25 | 50`, now decodes the value the wire carries. It
previously answered 400 to every conformant caller. `test/wire/` asserts it
through a real request as well, because a correct validator can still be reached
by nothing.

### Internal

The `headOnly` import is decided from the registration rather than by matching
generated text, the same latent failure as the `byContentType` one fixed in
0.5.0. Emitted output is unchanged by that.

## [0.5.0] - 2026-08-14

Requires `typespec-http-zod@^0.5.0`.

A minor because it changes emitted output, and because `byContentType`'s
signature in the emitted runtime has changed. If you have copied
`runtime.gen.ts` to substitute your own types, take the new one: regenerated
output calls the new signature.

### An operation accepting several request media types now emits a server that compiles

Declaring both a JSON and a form-encoded body on one operation emitted an
`app.gen.ts` that `tsc` rejected:

```
app.gen.ts(202,22): error TS2345: Argument of type '"json"' is not assignable
to parameter of type '"header"'.
```

`byContentType` was a plain middleware wrapping pre-built validators, so it
contributed nothing to Hono's chain and the handler's `c.req.valid("json")`
named a target the types did not carry. The same cause left the request body out
of the handler's declared input type on those routes, so the body arrived at run
time and was invisible to the compiler.

It now takes the body's schema, chooses the reader from the request's
`Content-Type`, and publishes what it validated under the body target whichever
reader ran. The emitted registration is the ordinary shape: one body middleware,
one `c.req.valid` spread, the body in the input type. The readers are Hono's
own, and a malformed JSON body raises the exception `zValidator` raises.

Only operations declaring request media types that need different parsers are
affected. Everything else emits exactly as before.

### A `HEAD` alone on its path

No behaviour change; the guard was correct and is now exercised by a fixture that
is compiled and requested, rather than only by corpus output that was neither.

## [0.4.0] - 2026-08-14

Requires `typespec-http-zod@^0.4.0`.

A minor because the library changes the shape of an emitted query validator: one
occurrence of an exploded list is boxed into the list the document describes.
`zValidator` delivers a bare string for a single occurrence and an array for
several, so `?topics=a` was refused while `?topics=a&topics=b` was accepted, the
same list decided by its length.

`style: form, explode: true` is OpenAPI's default for query parameters, so a
single occurrence IS a one-element array and the document said so all along. The
vocabulary guard admits the boxing on the same terms as the delimiter split: it
reshapes the wire into what the document already describes and runs every
constraint afterwards.

## [0.3.2] - 2026-08-13

A patch: nothing emitted changes. Closes the last of the pairs this package
produced or consumed that nothing compared.

The status arms the server hands `deps.respond` are compared to the responses the
document declares, over every operation in the corpus. Both sides are produced by
dependencies, so the comparison logic carries its own non-vacuity arm rather than
a control that perturbs this emitter, which could not move either side.

## [0.3.1] - 2026-08-13

A patch: nothing emitted changes. Two properties this package claimed were now
compared rather than asserted against expectations written by hand.

The gate the document publishes is compared to the gate the server applies, over
every operation in the 62-scenario corpus. The prefix the document publishes is
compared to the prefix the server mounts under. Both artefacts are derived
independently, this emitter from `@typespec/http` and the document from
`@typespec/openapi3` walking the program itself, so nothing but a comparison can
show that they agree. They do.

`compileFixture` can emit an OpenAPI document, which is what the base-path
comparison needed and no fixture previously had.

## [0.3.0] - 2026-08-13

Requires `typespec-http-zod@^0.3.0`.

Nothing this package emits has changed. The bump is a minor rather than a patch
because the library's `requests.gen.ts` changes shape, and a consumer regenerating
gets different contract types. A patch would have installed itself on anyone
holding `^0.2.0` and altered their generated types without an opt-in, which is
what this project's versioning policy exists to prevent.

### What the library fixed

A renamed parameter was keyed by its TypeSpec property name in the contracts and
by its wire name in the validator, so the two artefacts generated from one
document disagreed about the same request. `@header("x-thing")`, `@path("thing-id")`
and `@query("$select")` are all keyed by wire name now, matching what the
validator has always used and what the document publishes.

A raw binary request body was typed `string` in the contracts while the server
read `arrayBuffer()` and typed `ArrayBuffer`. Both say `ArrayBuffer` now. A `bytes`
value inside a JSON payload is still `string`.

Anyone using `contracts-output-dir` should regenerate. Without it, a handler
satisfying the contract types could not satisfy the generated `Operations`.

## [0.2.0] - 2026-08-13

A minor bump rather than a patch, because the emitted output changed. A consumer regenerating against
this release gets a different server: an extra file, routes that did not exist before, and a different
validator on some request bodies.

### The emitter is now a devDependency

The runtime is written beside the generated code as `runtime.gen.ts`, so nothing emitted imports this
package at run time. Install it with `pnpm add -D`. Previously it had to be a production dependency,
and `--save-dev` passed every local check and then failed at deploy with
`Could not resolve "typespec-hono/runtime"`.

`ResponseArm` and `armFor` are declared in this package rather than re-exported from
`typespec-http-zod`, so that a consumer's production dependencies stay clear of both emitters.

### `@head` operations are served

They were refused. Hono rewrites HEAD to GET before route matching, so a route registered under HEAD
is never reached, and the previous release excluded those operations with an `unroutable-verb` warning.
They are registered under GET now and told apart by `c.req.method`, which still reads `HEAD` after the
rewrite. Where a path declares only `@head`, a real GET gets the 404 it got before. Where a path
declares both, one registration serves both and each operation keeps its own handler.

Twelve operations across `@typespec/http-specs` moved from refused to served.

### Every declared `@server` is mounted

A service declaring several base paths was previously mounted at the root with an
`ambiguous-server-path` warning. There is nothing ambiguous about it: the document says the service
answers at all of them, and Hono mounts one sub-app under as many prefixes as it is given. Routes are
mounted under each.

### The request validator is chosen from `Content-Type`

An operation declaring several request media types got one `zValidator` fixed at generation time, so a
form-encoded body sent to a route that also accepts JSON was parsed as JSON and answered 400 with no
diagnostic. The validator is now selected from the request's `Content-Type`, which is the only point
at which the answer exists.

Media types no parser can handle, `application/xml` being the common one, are named by the new
`unvalidatable-media-type` warning rather than mis-parsed silently.

### Diagnostics

Added `unvalidatable-media-type`. Removed `unroutable-verb` and `ambiguous-server-path`, both of which
described things this release does rather than refuses.

### Requires `typespec-http-zod@^0.2.0`

That release stopped refusing unknown scalars and `never` properties and started emitting what the
document describes for both, so the validators this package pairs with a server are different. Coverage
over `@typespec/http-specs` moved with it: a scenario that previously failed to compile at all now
does, taking the graded corpus from 61 scenarios and 577 operations to 62 and 635, with refusals still
at zero.

### Documentation

The README is a README again rather than a manual, with the reference material in `docs/`.

## [0.1.0] - 2026-08-13

First release.
