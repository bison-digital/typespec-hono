# Changelog

All notable changes to `typespec-hono` are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**At `0.x` the public API is not frozen.** A minor bump may change the emitted output or the
published types; a patch will not. The **emitted output is part of the API**, a change to what
`registerRoutes` returns, to a validator's shape, or to what a handler receives is a change a
consumer feels, and is treated as such here rather than as an implementation detail.

## [Unreleased]

Nothing since `0.3.2`.

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
