# Changelog

All notable changes to `typespec-hono` are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**At `0.x` the public API is not frozen.** A minor bump may change the emitted output or the
published types; a patch will not. The **emitted output is part of the API**, a change to what
`registerRoutes` returns, to a validator's shape, or to what a handler receives is a change a
consumer feels, and is treated as such here rather than as an implementation detail.

## [Unreleased]

Nothing since `0.2.0`.

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

### Documentation

The README is a README again rather than a manual, with the reference material in `docs/`.

## [0.1.0] - 2026-08-13

First release.
