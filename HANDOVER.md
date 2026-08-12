# `typespec-hono` — where this work stands

Working record. Everything here is measured; where a number appears, it came from a command.

## START HERE

**State, 2026-08-12.** Extracted from a single un-split emitter, and now a thin consumer of
[`typespec-http-zod`](https://github.com/bison-digital/typespec-http-zod). **79 tests, 11 files,
typecheck clean, lint clean.**

**Three numbers to lead every report with: divergences · emitter warnings · named refusals. Today
they are `0 · 0 · 2`.** Say them unprompted and flag the moment one moves.

Divergences are the library's business — the validators are graded there, against the document. What
is graded HERE is whether a caller can reach any of it: **577 operations declared, 564 mounted, 13
refused**, and `mounted + refused === declared` is asserted.

The two refusals are `unroutable-verb` and `unsupported-path-template`. **Both are facts about Hono,
not about the spec** — `typespec-http-zod` emits correct validators for these operations; only a Hono
server cannot serve them. That division is the clearest evidence the split is real.

⚠️ **Nothing is published.** Publishing is public and permanent and needs explicit approval.

### The five things most easily lost

1. **A consumer lists ONE emitter.** This package runs the whole library and adds `app.gen.ts`. The
   server imports every validator BY NAME from `schemas.gen.js`, and it works because the library
   minted those names, wrote them, and handed them back — not because two emitters agree.
2. **`app.routes` lists routes Hono will never dispatch to.** That is how fifteen unreachable HEAD
   routes passed a differential written specifically to catch unreachable routes. Mounting and
   counting is necessary and not sufficient; the arithmetic has to account for refusals.
3. **The library is a sibling repository and the two move together.** `pnpm-workspace.yaml` overrides
   `typespec-http-zod` to a local link; the published manifest carries a real semver range and a test
   asserts it never carries a path. `test/reference/service.tsp` is vendored with a digest both
   repositories check.
4. **`pnpm typecheck` is the last gate, always.**
5. **`renderApp` declares no schema of its own**, asserted. If it ever does, the split has quietly
   stopped being real.

---

## How this work is done — the method, not the manners

⚠️ **This section is why the effort works. Numbers can be re-measured; this cannot be re-derived from
the code.**

**Find the work by asking what nothing is looking at.** The productive question is not "where is the
emitter wrong" but _what does the gate never open_.

**Grade the gate before grading what the gate grades.** The largest finding in this package's history
was caught this way and not by any test: a brand-new route differential reported 577 mounted of 577
declared, and thirteen of those routes were unreachable. The gate agreed with itself, because it
counted `app.routes` and Hono lists a registration it will never dispatch to.

**Ask the first-party question.** `unroutable-verb` exists because of four lines in `hono-base.js`:

```js
if (method === "HEAD") {
  return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
}
```

Read the framework's source. Then measure it: `on("PURGE", …)` and `on("OPTIONS", …)` both work, so
this is HEAD specifically and not a limitation of `on`. Fifteen of the seventeen HEAD operations in
`@typespec/http-specs` have no sibling GET, so all fifteen were 404s that counted as present.

**Refuse rather than approximate.** A route that works and is wrong is worse than one that fails.
Registering a HEAD handler under GET would invent an operation the document does not declare;
guarding it on `c.req.method` is not something a Hono author would write. Name the refusal, name the
remedy, and let the spec author decide.

**A refusal is a named exclusion of one operation, not a failed scenario.** `reportDiagnostic` does
not unwind, so everything else still emits. Treating a scenario as failed because one of its twenty
operations is refused blinds the differential to the other nineteen — measured on
`type/model/visibility`.

**Every guard gets a three-state control, on the day it is written.** Break it → red; revert **by
re-editing, never `git checkout`** → green. And ⚠️ **`git diff --exit-code` proves nothing about an
untracked file** — commit first, or compare bytes against a copy.

**Two suites must not compile one fixture to one directory.** Vitest runs files in parallel; the same
request answered 400, 200 and 204 across runs of an unchanged emitter until each configuration got
its own output directory. A suite that races itself is not evidence, and it looks exactly like a
flaky emitter.

**Assert the CLASS, never a list of members.** Option forwarding, refusal codes, the server's import
surface — all sets. Which corpus scenarios happen to declare `@head` is not a fact about this
emitter, so the refusal arm asserts the CODES and a floor on how many scenarios raise one.

---

## What the oracles are

| oracle | proves | catches |
| --- | --- | --- |
| **Route differential** (`test/conformance/routes.test.ts`) | every declared operation is mounted or refused | dropped operations, unreachable registrations, routes still carrying a path template |
| **Reference service** (`test/reference/`) | question 2 — Hono alone | hyphenated path parameters, negotiation registered once, no schema declared locally, emitted output compiles |
| **Wiring** (`test/wiring/`) | question 3 — both together | a signature no application can satisfy; and, by making REAL requests, every wire defect no document comparison can see |
| **Equivalence** (`test/equivalence/`) | the emitted server behaves like one somebody would write | a wrong verb, a bodied 204, a validation failure arriving as a 500 |
| **Vocabulary** (`test/vocabulary.test.ts`) | the generated server says only what the document can say, and declares no schema of its own | a non-derivable Zod call; a stray import; the split quietly stopping being real |
| **Options** (`test/options.test.ts`) | the option schema is derived, not restated | an option the library adds and this package silently drops |
| **Vendored fixture** (`test/vendored.test.ts`) | the shared spec has not drifted | an edit in either repository |
| **Packaging** (`test/packaging.test.ts`) | what a stranger gets | an entry point outside `files`; a `link:` range published |
| **Documentation** (`test/documentation.test.ts`) | a refusal is findable | a diagnostic or option nobody wrote down |

```bash
pnpm test        # everything
pnpm typecheck   # LAST, before every commit
```

`UPDATE_ROUTE_BASELINE=1` regenerates the route totals. **Scenarios, declared and mounted may only
grow; refusals may only shrink** — a new refusal is an operation this emitter has stopped serving,
which is a claim to justify in a commit rather than a number to absorb.

---

## Open, in the order I would take them

1. **`app.on(method, …)` is reachable in principle and exercised by nothing.** `@typespec/http`
   declares six verbs, five have Hono helpers, and the sixth is `@head`, which is refused. The branch
   is correct and defensive; it is also untested, and that is recorded in the README rather than
   hidden.
3. **Publishing.** Needs explicit approval, and the GitHub repositories do not exist yet. Note that
   CI checks out the library as a sibling, so **both** repositories must exist before CI passes.

### Done, and worth not redoing

- **The equivalence oracle** (`test/equivalence/`), ported and controlled: mutating the hand-written
  app's `204` to a `200` turns it red naming the exchange.

- **TypeSpec 1.14 → 1.15 and corpus alpha.40 → alpha.41** (`377effd`), in step with the library. 577
  declared, 564 mounted, 13 refused — unchanged.
- **TypeScript 6 → 7** (`fcd4106`). No change to the emitted declarations.
