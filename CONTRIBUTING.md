# Contributing to 1billion-js

Thank you for your help. Bug reports, docs fixes and pull requests are welcome.

## Before you start

- Search the [issues](https://github.com/clowk-in/1billion-js/issues) first.
- For a large change, open an issue and describe the idea before you write code.
- Security problems: do not open a public issue. See [SECURITY.md](SECURITY.md).
- This SDK follows the [1billion API](https://1billion.clowk.in/openapi.yml). A new endpoint comes to the 3 SDKs
  ([JavaScript](https://github.com/clowk-in/1billion-js), [Ruby](https://github.com/clowk-in/1billion-ruby),
  [Go](https://github.com/clowk-in/1billion-go)) with the same names and the same rules.

## Set up

You need Node.js 22 or newer and [pnpm](https://pnpm.io).

```bash
git clone https://github.com/clowk-in/1billion-js && cd 1billion-js
pnpm install
make test lint build
```

The unit tests use a fake `fetch`: no network and no API key. The integration test runs only when
`ONEBILLION_URL` is set:

```bash
ONEBILLION_URL=https://1billion.clowk.in ONEBILLION_API_KEY=<a test key> ONEBILLION_FROM="Test <hi@your-domain.com>" pnpm test
```

## Rules

- **Test first.** Write the failing test, then the code.
- **No runtime dependencies.** Only `fetch` and the platform. Use pnpm, not npm or yarn, for the lockfile.
- **Lint.** `pnpm lint` is clean. ESLint checks the blank lines: one before `return`, around `if`, `for`,
  `while`, `switch` and `try`, and after a group of declarations.
- **Simple.** Do the minimum that solves the problem. No speculative options.
- **The same rules as the other SDKs:** a retry only of `503` and network errors, 3 tries in all, with the same
  `Idempotency-Key`.
- **Docs.** A change that alters behavior updates `README.md` and the `Unreleased` section of
  [CHANGELOG.md](CHANGELOG.md) in the same pull request.

## Pull requests

1. Fork, and make a branch from `main`.
2. Make small commits. Use [Conventional Commits](https://www.conventionalcommits.org) for each message and the
   pull request title: `type(scope): summary`, with the types `feat`, `fix`, `docs`, `refactor`, `perf`, `test`,
   `build`, `ci` and `chore`. `release: X.Y.Z` is only for `make tag`.
3. Run `make test lint build`.
4. Open the pull request and fill in the template.

## Releases

The maintainers release from `main`:

- `make tag patch|minor|major` bumps the version in `package.json` and `src/index.ts`, closes the `Unreleased`
  section of `CHANGELOG.md`, makes the commit `release: X.Y.Z` and the tag `vX.Y.Z`, and asks before it pushes.
  `make tag 0.3.0` sets an exact version instead; it must be higher than the latest tag. `make -n tag minor` shows the next version and writes nothing.
- Or merge a commit with the subject `tag(patch): ...`, `tag(minor): ...` or `tag(major): ...`. When CI
  passes on `main`, `tag.yml` runs the same script.

When CI passes on the release commit, `release.yml` makes the GitHub release with the notes of
`CHANGELOG.md`, and `publish.yml` publishes the package to npm with provenance (with the secret `NPM_TOKEN`,
or with trusted publishing when the secret is not set).

## License

By contributing, you agree that your work is licensed under the [MIT license](LICENSE).
