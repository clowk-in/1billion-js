import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { test } from "node:test"

import { OneBillion, OneBillionError, verifySignature, type MailReceived } from "../src/index.ts"

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

const accepted = { messages: [{ id: "m1", to: "ana@x.com", status: "accepted" }, { id: "m2", to: "bia@x.com", status: "accepted" }] }

// Sets env vars for one call and puts the old values back after it.
async function withEnv(vars: Record<string, string | undefined>, run: () => unknown) {
  const old = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]))
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }

  apply(vars)

  try {
    await run()
  } finally {
    apply(old)
  }
}

function recorder(...answers: (Response | "network")[]) {
  const calls: { url: string; init: RequestInit }[] = []

  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })

    const answer = answers.shift()

    if (answer === "network") throw new TypeError("fetch failed")

    return answer as Response
  }

  return { calls, fetcher: fetcher as typeof fetch }
}

test("the key and the url come from the environment", async () => {
  await withEnv({ ONEBILLION_API_KEY: "env-key", ONEBILLION_URL: "http://env.test" }, async () => {
    const { calls, fetcher } = recorder(json(200, { id: "m1" }))

    await new OneBillion(undefined, { fetch: fetcher }).message("m1")

    assert.equal(calls[0].url, "http://env.test/messages/m1")
    assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer env-key")
  })
})

test("needs a key", async () => {
  await withEnv({ ONEBILLION_API_KEY: undefined }, () => {
    assert.throws(() => new OneBillion(), /ONEBILLION_API_KEY/)
  })
})

test("emails.send works like resend.emails.send", async () => {
  const { calls, fetcher } = recorder(json(202, accepted))
  const mail = new OneBillion("key", { url: "http://api.test", fetch: fetcher })

  const { data, error } = await mail.emails.send(
    {
      from: "App <hi@app.com>",
      to: ["ana@x.com", "bia@x.com"],
      replyTo: "help@app.com",
      subject: "Oi",
      html: "<p>Olá</p>",
      attachments: [{ filename: "a.txt", content: "b2k=", contentType: "text/plain" }],
    },
    { idempotencyKey: "k1" },
  )

  const body = JSON.parse(String(calls[0].init.body))

  assert.equal(error, null)
  assert.equal(data?.id, "m1")
  assert.equal(data?.messages.length, 2)
  assert.deepEqual(body.body, { html: "<p>Olá</p>" })
  assert.equal(body.reply_to, "help@app.com")
  assert.equal(body.attachments[0].content_type, "text/plain")
  assert.equal((calls[0].init.headers as Record<string, string>)["Idempotency-Key"], "k1")
})

test("emails.send returns an error and never throws", async () => {
  const { fetcher } = recorder(json(422, { error: "x@tmp.com: disposable" }), "network")
  const mail = new OneBillion("key", { fetch: fetcher, backoffMs: 0 })

  const refused = await mail.emails.send({ from: "a@app.com", to: "x@tmp.com", subject: "s", text: "t" })

  assert.equal(refused.data, null)
  assert.deepEqual(refused.error, { name: "validation_error", message: "x@tmp.com: disposable", statusCode: 422 })

  const down = recorder("network", "network", "network")
  const offline = await new OneBillion("key", { fetch: down.fetcher, backoffMs: 0 }).emails.send({ from: "a@app.com", to: "b@x.com", subject: "s", text: "t" })

  assert.equal(offline.error?.name, "network_error")
  assert.equal(offline.error?.statusCode, null)
})

test("emails.send refuses a key that 1billion does not support", async () => {
  const { calls, fetcher } = recorder(json(202, accepted))
  const mail = new OneBillion("key", { fetch: fetcher })
  const params = { from: "a@app.com", to: "b@x.com", subject: "s", text: "t", tags: [{ name: "a", value: "b" }] }

  const { data, error } = await mail.emails.send(params as Parameters<typeof mail.emails.send>[0])

  assert.equal(data, null)
  assert.equal(error?.name, "validation_error")
  assert.match(error?.message ?? "", /tags/)
  assert.equal(calls.length, 0)
})

const secret = "whsec_test"
const payload = JSON.stringify({ id: "e1", type: "delivered", message_id: "m1", to: "ana@x.com", detail: "250 ok", created_at: "2026-11-18T10:00:00.000Z" })

function signed(timestamp = Math.floor(Date.now() / 1000), key = secret, body = payload) {
  const hex = createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex")

  return { "1B-Event-Id": "e1", "1B-Timestamp": String(timestamp), "1B-Signature": `sha256=${hex}` }
}

test("verifySignature returns the event", () => {
  const event = verifySignature({ payload, headers: signed(), secret })

  assert.equal(event.type, "delivered")
  assert.equal(OneBillion.verifySignature({ payload: Buffer.from(payload), headers: new Headers(signed()), secret }).message_id, "m1")
})

test("verifySignature returns a received mail with its own type", () => {
  const received = JSON.stringify({
    id: "e2", type: "mail.received", message_id: "", to: "feedback@example.com", detail: "", created_at: "2026-11-19T12:00:01Z",
    data: {
      id: "r1", from: "Ana <ana@example.org>", to: "feedback@example.com", mail_from: "ana@example.org", subject: "Oi",
      message_id: "<a@example.org>", text: "Oi, tudo bem?", html: null,
      attachments: [{ filename: "nota.pdf", content_type: "application/pdf", size: 48213 }],
      auth: { spf: "pass", dkim: "pass", dmarc: "pass" }, size: 52011, received_at: "2026-11-19T12:00:00.000Z",
    },
  })

  const event = verifySignature({ payload: received, headers: signed(undefined, secret, received), secret })

  assert.equal(event.type, "mail.received")

  if (event.type !== "mail.received") return

  const mail: MailReceived = event.data

  assert.equal(mail.subject, "Oi")
  assert.equal(mail.html, null)
  assert.deepEqual(mail.attachments, [{ filename: "nota.pdf", content_type: "application/pdf", size: 48213 }])
  assert.deepEqual(mail.auth, { spf: "pass", dkim: "pass", dmarc: "pass" })
})

test("verifySignature takes header names in any case and the secret from the environment", async () => {
  const lower = Object.fromEntries(Object.entries(signed()).map(([name, value]) => [name.toLowerCase(), value]))

  await withEnv({ ONEBILLION_WEBHOOK_SECRET: secret }, () => {
    assert.equal(verifySignature({ payload, headers: lower }).id, "e1")
  })
})

test("verifySignature needs a secret", async () => {
  await withEnv({ ONEBILLION_WEBHOOK_SECRET: undefined }, () => {
    assert.throws(() => verifySignature({ payload, headers: signed() }), /ONEBILLION_WEBHOOK_SECRET/)
  })
})

test("verifySignature refuses a bad, missing or old signature", () => {
  const invalid = (error: OneBillionError) => error instanceof OneBillionError && error.name === "invalid_signature"
  const unsigned: Record<string, string> = signed()
  const old = Math.floor(Date.now() / 1000) - 301

  delete unsigned["1B-Signature"]

  assert.throws(() => verifySignature({ payload, headers: signed(undefined, "other"), secret }), invalid)
  assert.throws(() => verifySignature({ payload: payload.replace("delivered", "bounced"), headers: signed(), secret }), invalid)
  assert.throws(() => verifySignature({ payload, headers: unsigned, secret }), invalid)
  assert.throws(() => verifySignature({ payload, headers: signed(old), secret }), invalid)
  assert.equal(verifySignature({ payload, headers: signed(old), secret, tolerance: 600 }).id, "e1")
})
