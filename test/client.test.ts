import assert from "node:assert/strict"
import { test } from "node:test"

import { OneBillion, OneBillionError } from "../src/index.ts"

type Call = { url: string; init: RequestInit }

// A fetch that answers from a list and records each call, so no test needs the network.
function fakeFetch(...answers: (Response | "network")[]) {
  const calls: Call[] = []

  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })

    const answer = answers.shift()

    if (answer === "network") throw new TypeError("fetch failed")

    return answer as Response
  }

  return { calls, fetcher: fetcher as typeof fetch }
}

const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status })

const headersOf = (call: Call) => call.init.headers as Record<string, string>

test("sends a mail with its headers and body", async () => {
  const { calls, fetcher } = fakeFetch(json(202, { messages: [{ id: "m1", to: "ana@x.com", status: "accepted" }] }))
  const mail = new OneBillion("key", { url: "http://api.test", fetch: fetcher })

  const out = await mail.send({ from: "App <hi@app.com>", to: ["ana@x.com"], subject: "Oi", text: "Olá", replyTo: "help@app.com", idempotencyKey: "k1" })
  const body = JSON.parse(String(calls[0].init.body))

  assert.equal(out.messages[0].id, "m1")
  assert.equal(calls[0].url, "http://api.test/send")
  assert.equal(headersOf(calls[0])["Idempotency-Key"], "k1")
  assert.equal(headersOf(calls[0]).Authorization, "Bearer key")
  assert.match(headersOf(calls[0])["User-Agent"], /^onebillion-node\//)
  assert.deepEqual(body.body, { text: "Olá" })
  assert.equal(body.reply_to, "help@app.com")
})

test("retries a 503 and a network error with the same key", async () => {
  const { calls, fetcher } = fakeFetch(json(503, { error: "try again later" }), "network", json(202, { messages: [] }))
  const mail = new OneBillion("key", { url: "http://api.test", fetch: fetcher, backoffMs: 0 })

  await mail.send({ from: "a@app.com", to: "b@x.com", subject: "s", text: "t" })

  const keys = calls.map((call) => headersOf(call)["Idempotency-Key"])

  assert.equal(keys.length, 3)
  assert.equal(new Set(keys).size, 1)
  assert.ok(keys[0])
})

test("gives up after 3 tries, and never retries other errors", async () => {
  const busy = fakeFetch(json(503, {}), json(503, {}), json(503, {}))

  await assert.rejects(new OneBillion("key", { fetch: busy.fetcher, backoffMs: 0 }).message("m1"), (error: OneBillionError) => error.status === 503)
  assert.equal(busy.calls.length, 3)

  const refused = fakeFetch(json(422, { error: "disposable", check: "disposable", address: "x@tmp.com" }))
  const send = new OneBillion("key", { fetch: refused.fetcher }).send({ from: "a@app.com", to: "x@tmp.com", subject: "s", text: "t" })

  await assert.rejects(send, (error: OneBillionError) => error.refused && error.body.check === "disposable")
  assert.equal(refused.calls.length, 1)
})

test("a 429 says there are no credits for today", async () => {
  const { fetcher } = fakeFetch(json(429, { error: "not enough credits", retry_after: 3600, buy_url: "https://1billion.clowk.in/usage" }))
  const send = new OneBillion("key", { fetch: fetcher }).send({ from: "a@app.com", to: "b@x.com", subject: "s", text: "t" })

  await assert.rejects(send, (error: OneBillionError) => error.noCredits && error.body.buy_url !== undefined)
})

test("reads a message, unsuppresses and validates", async () => {
  const { calls, fetcher } = fakeFetch(json(200, { id: "m1", status: "sent" }), json(204, null), json(200, { valid: false, checks: [] }))
  const mail = new OneBillion("key", { url: "http://api.test", fetch: fetcher })

  assert.equal((await mail.message("m1")).status, "sent")
  await mail.unsuppress("ana@x.com")
  assert.equal((await mail.validate("x@tmp.com")).valid, false)
  assert.deepEqual(calls.map((call) => call.url), ["http://api.test/messages/m1", "http://api.test/suppressions/ana%40x.com", "http://api.test/validate"])
})

test("needs a key", () => {
  assert.throws(() => new OneBillion(undefined))
})

test("against a real console", { skip: !process.env.ONEBILLION_URL }, async () => {
  const mail = new OneBillion(process.env.ONEBILLION_KEY, { url: process.env.ONEBILLION_URL })
  const out = await mail.send({ from: process.env.ONEBILLION_FROM, to: ["sdk-node@gmail.com"], subject: "SDK Node", text: "Olá" })

  assert.equal((await mail.message(out.messages[0].id)).id, out.messages[0].id)
})
