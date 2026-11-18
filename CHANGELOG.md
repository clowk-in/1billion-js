# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The first release of `@clowk/1billion`, for Node.js 22 or newer, Next.js (on the server) and Bun.
- **`OneBillion`:** `send` (text, HTML, attachments, raw MIME, priority), `message`, `unsuppress` and `validate` (the verdict of an address, its score and its signals; 100 credits).
- A retry of a `503` and of a network error, 3 tries in all, with the same `Idempotency-Key`.
- `OneBillionError` with `status`, `body`, `noCredits` (429) and `refused` (422).
- Types for each request, answer and error.

[Unreleased]: https://github.com/clowk-in/1billion-js/compare/v0.0.0...HEAD
