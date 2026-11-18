<h1 align="center">
  <a href="https://1billion.clowk.in">1billion</a>
</h1>

<p align="center">
  <b>Transactional e-mail on its own sending infrastructure.</b><br>
  The official JavaScript SDK.
</p>

<p align="center">
  <a href="https://1billion.clowk.in"><b>Website</b></a> ·
  <a href="https://1billion.clowk.in"><b>Get an API key</b></a> ·
  <a href="https://1billion.clowk.in/openapi.yml"><b>API reference</b></a> ·
  <a href="CHANGELOG.md"><b>Changelog</b></a>
</p>

<p align="center">
  <a href="https://github.com/clowk-in/1billion-js/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/clowk-in/1billion-js/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@clowk/1billion"><img alt="npm" src="https://img.shields.io/npm/v/@clowk/1billion.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

The official JavaScript client of [1billion](https://1billion.clowk.in): transactional e-mail on its own
sending infrastructure. Send a login code, a receipt or a reset link from Node.js, a Next.js route or Bun, and
read what happened to each recipient.

- **No dependencies.** Only `fetch`, which Node.js and Bun have.
- **TypeScript first.** Types for each request, answer and error.
- **Safe retries.** A `503` or a network error is tried again with the same `Idempotency-Key`, so a retry never
  sends a mail twice.
- **Clear errors.** `error.noCredits` and `error.refused` tell you what to do next.
- **Address validation.** A verdict, a score and the signals of an address, before you send to it.

> Use it only on a server. There is no browser build: an API key must never reach a browser.

## Install

```bash
pnpm add @clowk/1billion
# or: npm install @clowk/1billion · bun add @clowk/1billion
```

Node.js 22 or newer, or Bun. The package is ESM only.

Make an API key in the [console](https://1billion.clowk.in), and verify the domain that you send from.

## Quick start

```ts
import { OneBillion } from "@clowk/1billion"

const mail = new OneBillion(process.env.ONEBILLION_KEY)

const { messages } = await mail.send({
  from: "Acme <hi@acme.com>",
  to: "jane@example.com",
  subject: "Your code",
  text: "Your code is 482 913",
})

console.log(messages[0].id)
```

`send` returns when 1billion has the mail (`202`, status `accepted`). The delivery runs after that, with its
own retries. Each recipient gets a message id of its own.

### Next.js (a route handler or a server action)

```ts
// app/api/login/route.ts
import { OneBillion } from "@clowk/1billion"

const mail = new OneBillion(process.env.ONEBILLION_KEY)

export async function POST(request: Request) {
  const { email } = await request.json()

  await mail.send({
    from: "Acme <hi@acme.com>",
    to: email,
    subject: "Your login link",
    html: `<a href="https://acme.com/login?token=…">Log in</a>`,
    priority: "high",
  })

  return Response.json({ ok: true })
}
```

Keep `ONEBILLION_KEY` without the `NEXT_PUBLIC_` prefix, so it never goes to the browser.

## Send

```ts
await mail.send({
  from: "Acme <hi@acme.com>",
  to: ["jane@example.com"],
  cc: "team@acme.com",
  bcc: "audit@acme.com",
  replyTo: "support@acme.com",
  subject: "Your receipt",
  text: "Thanks for your order.",
  html: "<p>Thanks for your <b>order</b>.</p>",
  attachments: [{ filename: "receipt.pdf", contentType: "application/pdf", content: base64Pdf }],
  priority: "high",
  idempotencyKey: "receipt-8812",
})
```

| Field | What |
|---|---|
| `from` | a sender on a verified domain of the app, with a name or without one |
| `to`, `cc`, `bcc` | one recipient or a list |
| `replyTo` | the reply address |
| `text`, `html` | the body: one of them or both |
| `attachments` | files, with `content` in base64 |
| `priority` | `"normal"` (the default) or `"high"`: mail that a person waits for goes first |
| `raw` | a finished MIME message, in place of the fields above |
| `idempotencyKey` | the same key in 30 days returns the first answer and sends nothing again |

When you do not pass an `idempotencyKey`, the client makes one and uses it for its own retries.

## Errors

```ts
import { OneBillionError } from "@clowk/1billion"

try {
  await mail.send(message)
} catch (error) {
  if (!(error instanceof OneBillionError)) throw error

  if (error.noCredits) {
    // 429: no credits for these recipients today. They come back at 00:00 in the time
    // zone of the workspace (error.body.retry_after seconds), or buy a pack (error.body.buy_url).
  } else if (error.refused) {
    // 422: a bad message, a domain that is not verified, or a recipient that failed a
    // check (error.body.check, error.body.address).
  } else {
    // Any other answer: error.status and error.body. status is 0 for a network error.
  }
}
```

| Status | What |
|---|---|
| `401` | a bad API key |
| `403` | the sends of the workspace are paused (low reputation); a person reviews it |
| `422` | `error.refused`: fix the message or the recipient |
| `429` | `error.noCredits` |
| `503` | tried again by the client |

Only a `503` and a network error are tried again: 3 tries in all, with a wait that doubles (500 ms, then 1 s).
No other error is tried again, because a second try gives the same answer.

## Read a message

```ts
const message = await mail.message(messages[0].id)

// message.status: accepted, queued, sending, sent, bounced or suppressed
// message.attempts, message.last_error, message.created_at, message.updated_at
```

`sent` means that the mail server of the recipient accepted the message. Messages stay for 30 days.

## Validate an address

```ts
const v = await mail.validate("jane@gmial.com")

// v.result:       "deliverable" | "risky" | "undeliverable"
// v.reason:       why, for example "possible_typo"
// v.score:        from 0 to 1
// v.did_you_mean: "jane@gmail.com"
// v.disposable, v.role, v.free, v.generated, v.mx_found, v.suppressed, ...
```

A validation sends nothing and costs 100 credits.

## Suppressions

A hard bounce or a complaint puts the address on the suppression list of the app, and 1billion stops sending
to it. When the address works again:

```ts
await mail.unsuppress("jane@example.com")
```

## Options

```ts
const mail = new OneBillion(process.env.ONEBILLION_KEY, {
  url: "http://localhost:3100",
  timeoutMs: 5_000,
  backoffMs: 1_000,
  fetch: myFetch,
})
```

| Option | Default | What |
|---|---|---|
| `url` | `https://1billion.clowk.in` | another console, for example a dev stack |
| `timeoutMs` | `10000` | the timeout of each try |
| `backoffMs` | `500` | the first wait between tries; it doubles each time |
| `fetch` | the global `fetch` | your own `fetch`, for a proxy or for tests |

Each request has the `User-Agent` `onebillion-node/<version>`, so the console shows which mails came from the
SDK.

## Start sending

1. Make a free account on **[1billion.clowk.in](https://1billion.clowk.in)**: 100 mails a day for free, every day, and your first domain for free.
2. Add your domain. The console gives you the DNS records, and checks them for you.
3. Make an API key, then `pnpm add @clowk/1billion`.

Your first mail goes out in a few minutes. A question about the SDK? [Open an issue](https://github.com/clowk-in/1billion-js/issues).

## Docs

- API reference: [openapi.yml](https://1billion.clowk.in/openapi.yml)
- Changes: [CHANGELOG.md](CHANGELOG.md)
- Other SDKs: [Ruby](https://github.com/clowk-in/1billion-ruby) (with ActionMailer) and
  [Go](https://github.com/clowk-in/1billion-go)

## Contributing

Bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. For a security
problem, see [SECURITY.md](SECURITY.md). This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE)
