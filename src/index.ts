/**
 * The client of 1billion: transactional e-mail on its own sending infrastructure. Use it only on a server
 * (Node.js, a Next.js route, Bun): an API key must never reach a browser.
 *
 * A 503 or a network error is tried again (3 times in all) with the same Idempotency-Key, so a
 * retry never sends twice. No other error is tried again.
 *
 * The API key comes from ONEBILLION_API_KEY and the base URL from ONEBILLION_URL, unless you pass them.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

export const VERSION = "0.3.0"

export const DEFAULT_URL = "https://1billion.clowk.in"

const TRIES = 3

export interface Attachment {
  filename: string
  content: string
  contentType?: string
}

export interface Mail {
  from?: string
  to?: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string
  subject?: string
  text?: string
  html?: string
  attachments?: Attachment[]
  priority?: "normal" | "high"
  raw?: string
  idempotencyKey?: string
}

/** The params of `emails.send`: the same fields as `resend.emails.send`. */
export type EmailParams = Pick<Mail, "from" | "to" | "cc" | "bcc" | "replyTo" | "subject" | "text" | "html" | "attachments" | "priority">

export interface EmailOptions {
  idempotencyKey?: string
}

/** The error of `emails.send`. `statusCode` is null for a network error. */
export interface EmailError {
  name: "validation_error" | "invalid_api_key" | "no_credits" | "network_error" | "api_error"
  message: string
  statusCode: number | null
}

/** The answer of `emails.send`: one of `data` and `error` is null. `data.id` is the id of the first message. */
export type EmailResult = { data: Accepted & { id: string }; error: null } | { data: null; error: EmailError }

/** The body of a webhook. Check `type` first: only a `mail.received` event has `data`. */
export type WebhookEvent = SentMailEvent | MailReceivedEvent

/** The event of a sent mail (or a test from the Webhooks page). */
export interface SentMailEvent {
  id: string
  type: "delivered" | "bounced" | "unsubscribed" | "test"
  message_id: string
  to: string
  detail: string
  created_at: string
}

/** A mail to an address whose route is "webhook". `message_id` is empty and `to` is the address that got it. */
export interface MailReceivedEvent extends Omit<SentMailEvent, "type"> {
  type: "mail.received"
  data: MailReceived
}

/** A received mail, whole. 1billion keeps no content, so this is the only time the app gets it. */
export interface MailReceived {
  id: string
  /** The From header. */
  from: string | null
  /** The address that got the mail. */
  to: string
  /** The sender of the envelope. */
  mail_from: string
  subject: string | null
  message_id: string | null
  /** Whole, never cut. */
  text: string | null
  /** Whole, never cut. */
  html: string | null
  /** The name, type and size of each file, never its content. */
  attachments: ReceivedFile[]
  /** What the mx of 1billion found of the sender. */
  auth: { spf: string; dkim: string; dmarc: string }
  size: number
  received_at: string
}

export interface ReceivedFile {
  filename: string
  content_type: string
  size: number
}

export interface VerifyParams {
  /** The raw body, as the server got it. */
  payload: string | Uint8Array
  /** A Headers object, or a plain object with names in any case (for example Node's `req.headers`). */
  headers: Headers | Record<string, string | string[] | undefined>
  /** ONEBILLION_WEBHOOK_SECRET by default. */
  secret?: string
  /** The seconds that a timestamp stays good, 300 by default. */
  tolerance?: number
}

const EMAIL_FIELDS = ["from", "to", "cc", "bcc", "replyTo", "subject", "text", "html", "attachments", "priority"]

export interface Accepted {
  messages: { id: string; to: string; status: string }[]
}

export interface Message {
  id: string
  to: string
  status: string
  attempts: number
  last_error: string
  created_at: string
  updated_at: string
}

export interface Validation {
  address: string
  user: string
  domain: string
  result: "deliverable" | "risky" | "undeliverable"
  reason: string
  score: number
  did_you_mean: string | null
  free: boolean
  role: boolean
  disposable: boolean
  generated: boolean
  subaddress: boolean
  base_address: string | null
  mx_found: boolean
  mx_host: string | null
  suppressed: boolean
  history: "delivered" | "bounced" | null
  credits: number
  duration_ms: number
  valid: boolean
  checks: { check: string; ok: boolean; detail: string }[]
}

export interface Options {
  url?: string
  backoffMs?: number
  timeoutMs?: number
  fetch?: typeof fetch
}

/** An answer that is not a success. `status` is 0 for a network error. */
export class OneBillionError extends Error {
  readonly status: number
  readonly body: Record<string, string | number>

  constructor(message: string, status = 0, body: Record<string, string | number> = {}) {
    super(message)

    this.name = "OneBillionError"
    this.status = status
    this.body = body
  }

  /**
   * 429: no credits for these recipients today. `body.retry_after` is the seconds until the
   * credits of the next day (00:00 UTC); `body.buy_url` is the page to buy a pack.
   */
  get noCredits(): boolean {
    return this.status === 429
  }

  /** 422: a bad message, or a recipient that failed a check (`body.check`, `body.address`). */
  get refused(): boolean {
    return this.status === 422
  }
}

/** A bad or missing webhook signature, or a timestamp out of the tolerance. */
export class InvalidSignatureError extends OneBillionError {
  constructor(message: string) {
    super(`1billion: ${message}`, 401)

    this.name = "invalid_signature"
  }
}

function header(headers: VerifyParams["headers"], name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined

  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]

  return Array.isArray(found) ? found[0] : found
}

/**
 * Checks the signature of a webhook and returns the event. `1B-Signature` is `sha256=<hex>`, with
 * hex = HMAC-SHA256(secret, "<1B-Timestamp>.<raw body>"). Throws an InvalidSignatureError.
 */
export function verifySignature({ payload, headers, secret = process.env.ONEBILLION_WEBHOOK_SECRET, tolerance = 300 }: VerifyParams): WebhookEvent {
  if (!secret) throw new Error("1billion: no webhook secret: set ONEBILLION_WEBHOOK_SECRET or pass secret")

  const timestamp = header(headers, "1B-Timestamp")
  const signature = header(headers, "1B-Signature")

  if (!timestamp || !signature) throw new InvalidSignatureError("no 1B-Timestamp or 1B-Signature header")

  const seconds = /^\d+$/.test(timestamp) ? Number(timestamp) : NaN

  if (!(Math.abs(Date.now() / 1000 - seconds) <= tolerance)) throw new InvalidSignatureError("the timestamp is out of the tolerance")

  const body = typeof payload === "string" ? payload : Buffer.from(payload).toString("utf8")
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`)
  const given = Buffer.from(signature)

  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new InvalidSignatureError("the signature does not match")

  return JSON.parse(body) as WebhookEvent
}

function emailError(error: unknown): EmailError {
  if (!(error instanceof OneBillionError)) return { name: "api_error", message: String(error), statusCode: null }

  const names: Record<number, EmailError["name"]> = { 0: "network_error", 401: "invalid_api_key", 422: "validation_error", 429: "no_credits" }
  const message = typeof error.body.error === "string" ? error.body.error : error.message

  return { name: names[error.status] ?? "api_error", message, statusCode: error.status || null }
}

export class OneBillion {
  static verifySignature = verifySignature

  /** The same call as `resend.emails.send`: it returns `{ data, error }` and never throws. */
  readonly emails = {
    send: async (params: EmailParams, options: EmailOptions = {}): Promise<EmailResult> => {
      const unknown = Object.keys(params).filter((key) => !EMAIL_FIELDS.includes(key))

      if (unknown.length > 0) {
        return { data: null, error: { name: "validation_error", message: `1billion does not support: ${unknown.join(", ")}`, statusCode: null } }
      }

      try {
        const answer = await this.send({ ...params, idempotencyKey: options.idempotencyKey })

        return { data: { id: answer.messages[0]?.id, ...answer }, error: null }
      } catch (error) {
        return { data: null, error: emailError(error) }
      }
    },
  }


  private readonly key: string
  private readonly url: string
  private readonly backoffMs: number
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch

  constructor(key?: string, options: Options = {}) {
    key ||= process.env.ONEBILLION_API_KEY

    if (!key) throw new Error("1billion: no API key: set ONEBILLION_API_KEY or pass it to new OneBillion()")

    this.key = key
    this.url = options.url ?? process.env.ONEBILLION_URL ?? DEFAULT_URL
    this.backoffMs = options.backoffMs ?? 500
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.fetcher = options.fetch ?? fetch
  }

  /** POST /send. */
  send(mail: Mail): Promise<Accepted> {
    const { idempotencyKey, replyTo, text, html, attachments, ...rest } = mail

    const body: Record<string, unknown> = { ...rest, reply_to: replyTo }

    if (text || html) body.body = { text, html }

    if (attachments) {
      body.attachments = attachments.map(({ contentType, ...file }) => ({ ...file, content_type: contentType }))
    }

    return this.request<Accepted>("POST", "/send", body, idempotencyKey ?? crypto.randomUUID())
  }

  message(id: string): Promise<Message> {
    return this.request<Message>("GET", `/messages/${encodeURIComponent(id)}`)
  }

  async unsuppress(address: string): Promise<void> {
    await this.request("DELETE", `/suppressions/${encodeURIComponent(address)}`)
  }

  /** The verdict of an address (result, reason, score and the signals). It sends nothing and costs 100 credits. */
  validate(address: string): Promise<Validation> {
    return this.request<Validation>("POST", "/validate", { address })
  }

  private async request<T>(method: string, path: string, body?: unknown, key?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      "User-Agent": `onebillion-node/${VERSION}`,
    }

    if (key) headers["Idempotency-Key"] = key

    const payload = body === undefined ? undefined : JSON.stringify(body)

    for (let attempt = 1; ; attempt++) {
      try {
        return await this.once<T>(method, path, headers, payload)
      } catch (error) {
        const retry = error instanceof OneBillionError && (error.status === 0 || error.status === 503)

        if (!retry || attempt === TRIES) throw error

        await new Promise((resolve) => setTimeout(resolve, this.backoffMs * 2 ** (attempt - 1)))
      }
    }
  }

  private async once<T>(method: string, path: string, headers: Record<string, string>, body?: string): Promise<T> {
    let response: Response

    try {
      response = await this.fetcher(this.url + path, { method, headers, body, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (error) {
      throw new OneBillionError(`1billion: ${(error as Error).message}`)
    }

    const text = await response.text()
    const data = text ? JSON.parse(text) : {}

    if (!response.ok) {
      throw new OneBillionError(`1billion: ${response.status} ${data.error ?? response.statusText}`, response.status, data)
    }

    return data as T
  }
}

export default OneBillion
