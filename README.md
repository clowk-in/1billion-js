# @clowk/1billion

The client of [1billion](https://1billion.clowk.in) for Node.js, Next.js (on the server) and Bun:
transactional e-mail on its own sending infrastructure. There is no browser build: an API key must never reach a browser.

```bash
pnpm add @clowk/1billion
```

```ts
import { OneBillion, OneBillionError } from "@clowk/1billion"

const mail = new OneBillion(process.env.ONEBILLION_KEY)

try {
  const { messages } = await mail.send({
    from: "App <hi@seu-dominio.com>",
    to: ["jane@exemplo.com"],
    subject: "Seu código",
    text: "Seu código é 482 913",
    priority: "high",
    idempotencyKey: "login-jane-482913",
  })
} catch (error) {
  if (error instanceof OneBillionError && error.noCredits) {
    // 429: no credits today (error.body.retry_after, error.body.buy_url)
  }
}

await mail.message("9f2c…")
await mail.unsuppress("jane@exemplo.com")
await mail.validate("jane@exemplo.com") // { valid, checks }
```

- A `503` or a network error is tried again, 3 times in all, with the same `Idempotency-Key` (made for you when
  you do not pass one). No other error is tried again.
- `OneBillionError` has `status`, `body`, `noCredits` (429) and `refused` (422, `body.check`, `body.address`).
- Options: `url`, `backoffMs`, `timeoutMs`, `fetch`.

The API is in [openapi.yml](https://1billion.clowk.in/openapi.yml).

## Tests

```bash
pnpm test && pnpm lint && pnpm build
ONEBILLION_URL=http://localhost:3100 ONEBILLION_KEY=dev-token ONEBILLION_FROM="Dev <hi@dev.test>" pnpm test
```

The second line runs the integration test against the dev stack of 1billion (`make up`: the console on `:3100`,
API key `dev-token`, domain `dev.test`).

## Release

Bump `version` in `package.json` first, then publish with the npm org `clowk`:

```bash
pnpm build && pnpm publish --access public
git tag vX.Y.Z && git push origin main vX.Y.Z
```
