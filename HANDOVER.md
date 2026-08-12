# `typespec-hono` — where this work stands

Working record. Everything here is measured; where a number appears, it came from a command.

## START HERE

**State, 2026-08-12.** A thin consumer of
[`typespec-http-zod`](https://github.com/bison-digital/typespec-http-zod). **121 tests, 21 files,
typecheck clean, lint clean, format clean — all four green on a CLEAN tree.**

**Three numbers to lead every report with: divergences · emitter warnings · named refusals. Today
they are `0 · 0 · 2`.** Say them unprompted and flag the moment one moves.

Divergences are the library's business. What is graded HERE is whether a caller can reach any of it:
**577 operations declared, 564 mounted, 13 refused**, `mounted + refused === declared`, and the
baseline reproduces byte-identically from a clean checkout.

⚠️ **Nothing is published.** The GitHub repository now exists and is public; nothing is pushed to it
yet. Publishing to npm is public, permanent, and needs explicit approval.

### The six things most easily lost

1. **A consumer lists ONE emitter.** This package runs the whole library and adds `app.gen.ts`. The
   server imports every validator BY NAME from `schemas.gen.js`, and that works because the library
   minted those names, wrote them, and handed them back.
2. **`registerRoutes` CHAINS and returns the chain.** Not style: `hc<T>` derives its entire surface
   from the `Schema` type Hono accumulates through chaining. As separate statements,
   `hc<typeof app>` resolved to **`unknown`** — Hono's RPC client was categorically unavailable.
3. **Refusals are `warning`, not `error`.** An error sets `program.hasError()` and
   `@typespec/openapi3` then writes **no document at all**. One `@head` operation cost a consumer
   their entire OpenAPI file. A consumer who wants a refusal to fail the build uses `warn-as-error`.
4. **Install as a `dependency`.** `./runtime` exports runtime values, and `--save-dev` fails only at
   deploy — every earlier signal is green because every earlier check runs with dev deps present.
5. **`app.routes` lists routes Hono will never dispatch to.** That is how fifteen unreachable HEAD
   routes passed a differential written to catch unreachable routes.
6. **`pnpm typecheck` is the last gate, always.** And ⚠️ **`pnpm vitest run` skips the build** —
   `pnpm test` is `tsc -p tsconfig.build.json && vitest run`. Two three-state controls "passed" here
   against a stale `dist` before that was noticed.

---

## How this work is done — the method, not the manners

⚠️ **This section is why the effort works. Numbers can be re-measured; this cannot be re-derived from
the code.**

**Find the work by asking what nothing is looking at.** Not "where is the emitter wrong" — the
productive question is _what does the gate never open_. Every significant finding below came from
that question rather than from a failing test.

**Be the first adopter.** Install from a `pnpm pack` tarball into a fresh project outside the repo,
write a spec, compile, wire it up, `wrangler dev` it. Several defects were invisible to 83 passing
tests and obvious within an hour of doing that, because **the harness configures away the path a
consumer takes** — it set `runtime-module` on every compile, it ran with dev dependencies present,
and it never sent a request carrying a number.

**Grade the gate before grading what the gate grades.** More defects here were in the ORACLES than in
the emitters, and every one accused the emitter falsely.

**Every guard gets a three-state control, on the day it is written.** Break it → red; revert **by
re-editing, never `git checkout`** → green. ⚠️ `git diff --exit-code` proves nothing about an
untracked file — `cmp` against a byte copy.

**Non-vacuity floors, and audit them against what they actually read.** A floor an order of magnitude
under its measurement is a floor in name only. One arm here read **315 files against a floor of 20**.

**Assert the CLASS, never a list of members.** And when a class assertion refuses a change, answer it
rather than widen it — the vocabulary guard refused the wire decodes and was right to; the carve-out
was extended as SHAPES with their own floors, not loosened to a count.

**Ask the first-party question.** Read `hono-base.js`. Read `@typespec/openapi3`'s source. Both
refusals, and the severity decision, come from what those say rather than from what a test did.

**Refuse rather than approximate.** A route that works and is wrong is worse than one that fails.

---

## What the oracles are

| oracle                                                     | proves                                                                                                             | catches                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| **Route differential** (`test/conformance/routes.test.ts`) | every declared operation is mounted or refused                                                                     | dropped operations, unreachable registrations, a scenario silently ungraded                         |
| **Wire** (`test/wire/wire.test.ts`)                        | what ARRIVES is accepted                                                                                           | a numeric path parameter, a multipart upload, a binary body — none visible to a document comparison |
| **Middleware** (`test/wire/middleware.test.ts`)            | an app can wrap the routes                                                                                         | per-resource middleware becoming unreachable; `routePath` or `onError` breaking                     |
| **Streaming** (`test/wire/streaming.test.ts`)              | a server can stream, and validators still run first                                                                | streaming becoming a way around the contract                                                        |
| **Adopter** (`test/adopter.test.ts`)                       | output emitted with NO options compiles                                                                            | the default path, which every other compile configures away                                         |
| **Idioms** (`test/idioms.test.ts`)                         | the output is what a Hono author would write                                                                       | drift from Hono's own best-practices guide                                                          |
| **Wiring** (`test/wiring/`)                                | an app compiles against it, and `hc` works                                                                         | a signature no application can satisfy; RPC silently foreclosed                                     |
| **Equivalence** (`test/equivalence/`)                      | it behaves like a hand-written Hono app                                                                            | a wrong verb, a bodied 204, a validation failure arriving as a 500                                  |
| **Vocabulary** (`test/vocabulary.test.ts`)                 | the server says only what the document can say                                                                     | a non-derivable Zod call; the split quietly stopping being real                                     |
| **Isolation** (`test/isolation.test.ts`)                   | no two test files share an output directory                                                                        | the race that made one request answer 400, 200 and 204 across three runs                            |
| **Sweep coverage** (`test/sweep-coverage.test.ts`)         | the sweeps read the whole corpus                                                                                   | coverage narrowed while every number stays green                                                    |
| **Packaging** (`test/packaging.test.ts`)                   | what a stranger gets                                                                                               | an entry point outside `files`; a `link:` range published; a wrong install instruction              |
| **Portability** (`test/portability.test.ts`)               | no machine path, tracked or generated                                                                              | an absolute specifier that resolves on one machine                                                  |
| **Attribution** (`test/attribution.test.ts`)               | no tool credited, one identity                                                                                     | a trailer in a commit nobody re-reads                                                               |
| **Provenance · Documentation · Options · Vendored**        | no foreign codebase names; every diagnostic documented; options forwarded as a class; the shared fixture undrifted |                                                                                                     |

```bash
pnpm test        # everything — builds first
pnpm typecheck   # LAST, before every commit
```

`UPDATE_ROUTE_BASELINE=1` regenerates the route totals. **Scenarios, declared and mounted may only
grow; refusals may only shrink.**

---

## Defects found by being the first adopter

Every one of these passed the full suite before it was found.

| what                                                                                                                                                                                                    | how it became visible                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **The generated server did not compile with default options.** `runtime-module` defaulted to a module exporting none of the six names `app.gen.ts` imports, and which a consumer cannot resolve at all. | `tsp compile` reported zero diagnostics; `tsc` then reported two `TS2307`s. Every compile in both suites set the option.    |
| **Every numeric path or query parameter refused every conformant caller.** `z.number().int()` met `"1"` from `c.req.param()`.                                                                           | `GET /pet/1 → 400` while `GET /user/zach → 200`. Every parameter in the only request-making fixture was a `string`.         |
| **`content-type` validated as an exact literal**, so every multipart request failed — the boundary parameter RFC 2046 requires is what the literal refused.                                             | 78 such validators across the corpus, 17 of them multipart.                                                                 |
| **Multipart bodies validated as JSON**, and a binary body read with `c.req.text()` — 18 bytes arrived as 23 code points, five destroyed, answering **200**.                                             | Only by sending a request carrying bytes that are not valid UTF-8.                                                          |
| **A refusal destroyed the consumer's OpenAPI document.**                                                                                                                                                | Adding one `@head` took `openapi/` from one file to none — and it was order-dependent, which is the tell it was accidental. |
| **`hc` was foreclosed.**                                                                                                                                                                                | `hc<typeof app>` resolved to `unknown`. A hand-chained app with the identical sub-app shape worked perfectly.               |
| **`--save-dev` fails at deploy.**                                                                                                                                                                       | `pnpm install --prod` then `wrangler deploy --dry-run` → `Could not resolve "typespec-hono/runtime"`.                       |

## Defects found in the ORACLES

| what                                                                                                                                                                                                                                                           | how it was found                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Neither suite had ever passed on a clean tree.** `vocabulary` and `packaging` graded whatever `.gen.ts` files were on disk — written by other test files, unordered under vitest's parallelism. Clean → red; second run → green, grading the PREVIOUS build. | A three-state control passed green with the fix deleted from `src/`.                                          |
| **The route baseline was not reproducible.** Thirteen scenarios had no document, so `577 · 564 · 13` could only have been recorded against files an earlier build left behind.                                                                                 | Guarding the crash that had been hiding it.                                                                   |
| **`refused` fell to zero** when refusals became warnings, because the harness keyed on severity rather than on the diagnostic code.                                                                                                                            | `mounted + refused === declared` broke at 564 + 0.                                                            |
| **A floor read 315 files against a threshold of 20.**                                                                                                                                                                                                          | Auditing every counting assertion against its measured value, after finding the same fault twice by accident. |
| **`provenance` asserted a literal call spelling** and accused the emitter when the call gained an argument, while every property it protects still held.                                                                                                       | Its own failure, on a change that broke nothing.                                                              |

---

## Open, in the order I would take them

1. **Push to GitHub.** The repository exists and is public; the push needs the `workflow` scope on the
   local `gh` token because of `.github/workflows/`. ⚠️ Do not delete the workflows to get around it.
2. **`application/xml` request bodies are validated as JSON.** There is no Hono target for XML and no
   Zod representation the document justifies. Five such bodies in the Swagger Petstore. Stated in the
   README as a limit rather than guessed at.
3. **Publishing.** Needs explicit approval. ⚠️ **`typespec-http-zod` must be published first** — this
   package depends on it by a semver range, so the reverse order makes this uninstallable for
   everyone.
