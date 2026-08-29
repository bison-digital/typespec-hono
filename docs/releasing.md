# Releasing

Two packages, one of which depends on the other **through the registry**. That is the whole reason
this page exists.

## The problem

`typespec-hono` declares `typespec-http-zod` as an ordinary dependency, resolved by version range.
So a change spanning both cannot be verified the way either one alone can:

- CI cannot verify it. `typespec-hono`'s workflow runs `pnpm install --frozen-lockfile`, which
  resolves the library from npm. A version that is not published yet cannot install, so a commit
  bumping the range fails at the install step rather than at a test.
- Committing the bump early therefore reddens `main` until the library publishes.
- And the pair a consumer actually gets - `npm install typespec-hono` pulling the library
  transitively - is a resolution neither repository's suite performs.

It reads like a chicken-and-egg: you cannot prove the pair works until it is published, and you do
not want to publish until it is proven.

## It is not one. Rehearse against a local registry.

Publish both packages to a registry running on your machine, then install from it exactly as a
stranger would. This is the same evidence a real publish gives, minus the irreversibility.

```bash
# 1. A registry that accepts anonymous publishes for these two names and proxies everything else.
mkdir -p /tmp/rehearsal/storage && cd /tmp/rehearsal
cat > config.yaml <<'YAML'
storage: ./storage
uplinks: { npmjs: { url: https://registry.npmjs.org/ } }
packages:
  'typespec-hono':     { access: $all, publish: $anonymous }
  'typespec-http-zod': { access: $all, publish: $anonymous }
  '@*/*':              { access: $all, proxy: npmjs }
  '**':                { access: $all, proxy: npmjs }
log: { type: stdout, format: pretty, level: warn }
YAML
printf 'registry=http://localhost:4873/\n//localhost:4873/:_authToken=rehearsal\n' > npmrc
npx --yes verdaccio@6 --config ./config.yaml --listen 4873 &

# 2. Publish the library, then the server AT ITS RELEASE VERSION with the real dependency range.
#    `--provenance=false` because provenance needs a CI OIDC identity; the real publish keeps it on.
cd <typespec-http-zod> && NPM_CONFIG_USERCONFIG=/tmp/rehearsal/npmrc \
  npm publish --registry http://localhost:4873 --provenance=false
cd <typespec-hono>     && NPM_CONFIG_USERCONFIG=/tmp/rehearsal/npmrc \
  npm publish --registry http://localhost:4873 --provenance=false

# 3. Install into an EMPTY directory and use it as a consumer does.
mkdir -p /tmp/cleanroom && cd /tmp/cleanroom
printf 'registry=http://localhost:4873/\n' > .npmrc
npm install --save-dev typespec-hono zod hono @hono/zod-validator \
  @typespec/compiler @typespec/http @typespec/openapi typescript
```

Then, in that directory: write a spec, `tsp compile .`, `tsc --noEmit` a consumer file against the
emitted types, and serve real requests through the generated app.

**Check what the registry resolved, not what you asked for.** The point of the exercise is the
transitive edge:

```bash
node -e "for (const p of ['typespec-hono','typespec-http-zod','zod'])
  console.log(p, require('./node_modules/'+p+'/package.json').version)"
```

### What this catches that a tarball does not

`pnpm pack` plus a `file:` override is quicker and is **not** the same test. It skips version-range
resolution entirely, so it cannot tell you that `^0.24.0` reaches the library, that a peer range is
satisfiable, or that the transitive install lands at all. It also writes a machine-local path into
`pnpm-lock.yaml`, which `attribution.test.ts` and `portability.test.ts` will refuse if it is ever
committed - correctly.

Use a tarball while iterating. Use the registry before releasing.

## Order

The library publishes first, always, because the server resolves it by range.

1. Rehearse, as above, with both packages at their release versions.
2. Release the library. **The first publish is also the pipeline's canary** - it is the one that
   proves the token, OIDC and provenance still work. If it fails, nothing else has gone out.
3. Confirm by `npm view typespec-http-zod version`, not by the workflow's colour. The registry lags
   the workflow by a minute; that is not a failure.
4. Only then bump `typespec-hono`'s dependency range, run its gates against the published library,
   and release it.
5. **Prove the release against the reference consumer.**

   ```bash
   gh workflow run CI --repo bison-digital/typespec-hono-example
   ```

   [`typespec-hono-example`](https://github.com/bison-digital/typespec-hono-example) has a `latest`
   job that installs whatever is newest on npm rather than what it has pinned, so it fails when a
   release breaks a real consumer. It also runs daily, which catches a bad release nobody thought to
   check - but a release is exactly when you want the answer immediately rather than tomorrow.

   It is the last thing that can tell you the release is wrong, and the first thing to go stale if
   nobody moves it: it sat eighteen minor versions behind for weeks, demonstrating an emitter nobody
   could install.

## On prereleases

A `-rc` publish is worth it only when it proves something the rehearsal cannot, and the rehearsal
covers everything except the npm publish path itself. Step 2 already covers that, on a version you
were releasing anyway - so an `rc` usually just burns a version number that can never be reused.

Reach for one when the release is genuinely hard to reverse in a way the rehearsal cannot model: a
change whose blast radius is the ecosystem rather than this repository.
