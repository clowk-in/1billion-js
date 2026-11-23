# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The event of a received mail: `WebhookEvent` is now `SentMailEvent | MailReceivedEvent`. A `mail.received`
  event has `data`, a `MailReceived` with the whole mail (`from`, `subject`, `text`, `html`, `attachments`,
  `auth` and more). Check `event.type === "mail.received"` and TypeScript knows that `data` is there.

## [0.3.0] - 2026-11-18

### Added

- `mail.emails.send(params, { idempotencyKey })`: the same call as `resend.emails.send`. It returns `{ data, error }` and never throws. A field that 1billion does not support gives a `validation_error`.
- `OneBillion.verifySignature({ payload, headers })` (also a named export): checks the signature of a webhook and returns the event. It throws an `InvalidSignatureError`.

### Changed

- `new OneBillion()` takes the key from `ONEBILLION_API_KEY` and the URL from `ONEBILLION_URL` when you do not pass them.
- The env var of the docs and of the integration test is `ONEBILLION_API_KEY` (it was `ONEBILLION_KEY`).

## [0.1.0] - 2026-11-18

### Added

- The first release of `@clowk/1billion`, for Node.js 22 or newer, Next.js (on the server) and Bun.
- **`OneBillion`:** `send` (text, HTML, attachments, raw MIME, priority), `message`, `unsuppress` and `validate` (the verdict of an address, its score and its signals; 100 credits).
- A retry of a `503` and of a network error, 3 tries in all, with the same `Idempotency-Key`.
- `OneBillionError` with `status`, `body`, `noCredits` (429) and `refused` (422).
- Types for each request, answer and error.

[Unreleased]: https://github.com/clowk-in/1billion-js/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/clowk-in/1billion-js/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/clowk-in/1billion-js/releases/tag/v0.1.0
