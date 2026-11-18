# 1billion-js — guide for AI agents

Read this file first. It tells you what this repo is, how to test it, and its rules.

## What it is

The official JavaScript client of [1billion](https://1billion.clowk.in), a transactional e-mail API: the npm
package `@clowk/1billion`, for Node.js 22 or newer, Next.js (on the server) and Bun. It is TypeScript, ESM
only, with no runtime dependencies. The API it follows is [openapi.yml](https://1billion.clowk.in/openapi.yml).

| Path | What |
|---|---|
| `src/index.ts` | `OneBillion` (`send`, `message`, `unsuppress`, `validate`), `OneBillionError`, the types, `VERSION` |
| `test/client.test.ts` | `node:test`, with a fake `fetch`: no network |
| `dist/` | the build (`pnpm build`), git-ignored |

The same SDK exists for Ruby (`clowk-in/1billion-ruby`) and Go (`clowk-in/1billion-go`). The 3 keep the same
names and the same rules. A change to one usually needs the same change in the other two.

## Run and test

```bash
pnpm install
make test    # node --test, runs the .ts files directly
make lint    # eslint, flat config
make build   # tsc to dist/
```

The integration test runs only with `ONEBILLION_URL`, `ONEBILLION_KEY` and `ONEBILLION_FROM`.

## Rules

- **Test first.** Write the failing test, then the code.
- **pnpm only** for `package.json` and the lockfile.
- **The retry rule:** only a `503` and a network error are tried again, 3 tries in all, with the same
  `Idempotency-Key`. The client makes the key when the caller does not pass one.
- **No runtime dependencies** and no browser build: an API key must never reach a browser.
- **Simple:** the minimum that solves the problem. No speculative options.
- **Blank lines:** one before `return`, around `if`, `for`, `while`, `switch` and `try`, after a group of
  declarations, and between groups of lines that do different jobs. ESLint checks most of it.
- **Docs change with behavior** in the same commit: `README.md` and the `Unreleased` section of `CHANGELOG.md`.
- **Docs style:** short sentences and simple words (ASD-STE100 style), as in the existing pages.
- This is a public repo. Never put an API key, a customer address or a private host in code, tests or docs.

## Release

- `make tag patch|minor|major` (`scripts/release.sh`) bumps the version in `package.json` and in `VERSION` of
  `src/index.ts`, closes the `Unreleased` section of `CHANGELOG.md`, commits `release: X.Y.Z`, tags `vX.Y.Z` and
  asks before the push. `YES=1` pushes without asking. `make -n tag minor` is a dry run.
- A commit `tag(patch|minor|major): ...` on `main` does the same through `tag.yml`, after CI passes.
- CI tests the release commit, then `release.yml` makes the GitHub release and `publish.yml` publishes to npm.
- Never push a `v*` tag or publish by hand: the two versions must match the tag.

## Git

- **Conventional Commits** for every commit and PR title: `type(scope): summary`, lower case type, summary in
  the imperative, no period at the end. Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`,
  `ci`, `chore`.
- Commit only when the maintainer asks. Do not watch CI: the maintainer follows it.
- Never credit Claude in a commit or a PR: no `Co-Authored-By: Claude` trailer, no "Generated with Claude Code"
  line. The author is always the maintainer.
