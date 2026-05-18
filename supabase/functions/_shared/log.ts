// Structured logger used by every OCR edge function.
// Each line starts with [<fn>:<reqId>:<step>:+<ms>] so a single request can be
// grepped out of the Supabase function log stream end-to-end.

export class Log {
  readonly fn: string
  readonly reqId: string
  readonly t0: number

  constructor(fn: string, reqId: string) {
    this.fn = fn
    this.reqId = reqId
    this.t0 = Date.now()
  }

  private prefix(step: string): string {
    const dt = Date.now() - this.t0
    return `[${this.fn}:${this.reqId}:${step}:+${dt}ms]`
  }

  step(step: string, data?: unknown): void {
    if (data === undefined) {
      console.log(this.prefix(step))
    } else if (typeof data === 'string') {
      console.log(this.prefix(step), data)
    } else {
      try {
        console.log(this.prefix(step), JSON.stringify(data))
      } catch {
        console.log(this.prefix(step), String(data))
      }
    }
  }

  block(step: string, label: string, body: string): void {
    const head = this.prefix(step)
    console.log(`${head} ${label} (length=${body.length}):\n${body}\n${head} /${label}`)
  }

  warn(step: string, data?: unknown): void {
    if (data === undefined) console.warn(this.prefix(step))
    else console.warn(this.prefix(step), typeof data === 'string' ? data : JSON.stringify(data))
  }

  error(step: string, data?: unknown): void {
    if (data === undefined) console.error(this.prefix(step))
    else console.error(this.prefix(step), typeof data === 'string' ? data : JSON.stringify(data))
  }
}

export function shortId(): string {
  return crypto.randomUUID().slice(0, 8)
}
