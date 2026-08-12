# Vendored fixtures

## `service.tsp`

Vendored from **`typespec-http-zod`**, `test/reference/service.tsp`.

```
sha256  72a394bd3fcf64bcbac0c45c8456b7ef1ca5b828b37ce1fa2101c72504f7f2e7
```

**Why a copy rather than an import.** `typespec-http-zod` does not ship test material: its `files`
list carries `dist` and `lib` only, and `@typespec/openapi3` — the reference implementation for a
TypeSpec emitter package — does the same, excluding `dist/test/**` explicitly. Shipping a fixture
would make it de-facto public API, delivered to every installer forever, for the benefit of one
sibling repository.

**Why this one file and no other.** The two packages want different fixtures: this one needs routing,
wiring and scope breadth, the library needs schema and constraint breadth. They share exactly
`service.tsp`, and only because **question 3 — can an application be built on both, and does it
answer real requests correctly? — requires one spec that both halves serve.** Nothing else here is
shared, and sharing more would be false economy.

⚠️ **Vendoring DETECTS drift; it does not prevent a stale copy.** Both repositories assert their copy
against the digest above, so an edit to either fails the other on its next run. A copy that has fallen
behind the *emitter* rather than behind the file is a different failure, and what catches that is
question 3 compiling this copy — not this digest.

Regenerate with:

```bash
shasum -a 256 test/reference/service.tsp
```
