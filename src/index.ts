/**
 * The client of 1billion: transactional e-mail on its own sending infrastructure. Use it only on a server
 * (Node.js, a Next.js route, Bun): an API key must never reach a browser.
 *
 * A 503 or a network error is tried again (3 times in all) with the same Idempotency-Key, so a
 * retry never sends twice. No other error is tried again.
 */

export const VERSION = "0.1.0"

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
  subaddress: boolean
  base_address: string | null
  mx_found: boolean
  mx_host: string | null
  suppressed: boolean
  history: "delivered" | "bounced" | null
  credits: number
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

export class OneBillion {
  private readonly key: string
  private readonly url: string
  private readonly backoffMs: number
  private readonly timeoutMs: number
  private readonly fetcher: typeof fetch

  constructor(key: string | undefined, options: Options = {}) {
    if (!key) throw new Error("1billion: the API key is required")

    this.key = key
    this.url = options.url ?? DEFAULT_URL
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

  /** The checks of an address. It sends nothing and costs nothing. */
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
