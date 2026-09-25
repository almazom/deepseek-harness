/**
 * Delivery observability: a JSONL send log, failure alerts, and a DMARC digest.
 *
 * The log is the operator's answer to "what did the agents send, and did it
 * land?". It never carries a message body, and it hashes recipients by default,
 * so the file can be read, shipped, or pasted into a report without leaking
 * who the family writes to.
 * @module @deepseek-ai/dsh-mail/sendlog
 */

import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import type { MailGuard, RefusalContext, SendRequest } from './seam.ts'
import type { Letter, SendFailure, SendOutcome, Transport } from './types.ts'

/** One line of the delivery log. */
export interface SendLogRecord {
  /** ISO-8601 timestamp. */
  readonly at: string
  /** What happened: a delivery, a transport failure, a refusal, or a reported bounce. */
  readonly status: 'sent' | 'failed' | 'refused' | 'bounced'
  /** Transport that handled the attempt, when one was involved. */
  readonly transport?: Transport
  /** Message-ID of the letter, when one was rendered. */
  readonly messageId?: string
  /** Envelope sender. */
  readonly from: string
  /** Recipients: hashed digests unless the local log stores full addresses. */
  readonly recipients: readonly string[]
  /** Subject, which is metadata rather than content. */
  readonly subject?: string
  /** Refusal code, for `failed` and `refused`. */
  readonly code?: string
  /** Rule scope that refused the letter. */
  readonly scope?: string
  /** Extra detail: an offending file name, a recipient, a count. */
  readonly detail?: string
  /** Who asked for the send: a shell user or an MCP session. */
  readonly actor?: string
}

/**
 * Stable, salted digest of one address.
 * @param address - the recipient address.
 * @param salt - the per-host salt.
 * @returns the digest, prefixed so it cannot be mistaken for an address.
 */
export function hashRecipient(address: string, salt: string): string {
  return `sha256:${createHash('sha256').update(`${salt}:${address.toLowerCase()}`).digest('hex').slice(0, 32)}`
}

/**
 * Read the per-host salt, creating it on first use with owner-only permissions.
 * @param saltPath - where the salt lives.
 * @returns the salt.
 */
export async function ensureSalt(saltPath: string): Promise<string> {
  try {
    const existing = (await readFile(saltPath, 'utf8')).trim()
    if (existing.length > 0) return existing
  } catch {
    // fall through to creation
  }
  const salt = randomBytes(16).toString('hex')
  await mkdir(dirname(saltPath), { recursive: true, mode: 0o700 })
  await writeFile(saltPath, `${salt}\n`, { mode: 0o600 })
  return salt
}

/**
 * Append one record to the JSONL log.
 * @param path - log file path.
 * @param record - the record.
 */
export async function appendSendLogRecord(path: string, record: SendLogRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await appendFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 })
}

/** Construction knobs for {@link SendLog}. */
export interface SendLogOptions {
  /** JSONL log path. */
  readonly logPath: string
  /** Salt file for recipient hashing; created on first use. */
  readonly saltPath?: string
  /** Store full addresses — only for the owner-only local log. */
  readonly exposeAddresses?: boolean
  /** Actor attributed to every record, e.g. the CLI user or the MCP session. */
  readonly actor?: string
  /** Alert channel notified after repeated failures. */
  readonly alerter?: FailureAlerter
  /** Clock override, for tests. */
  readonly now?: () => Date
}

/**
 * The guard that writes the delivery log.
 *
 * Both outcomes and refusals are recorded: an audit trail that only lists
 * successful sends cannot show an operator that an agent tried.
 */
export class SendLog implements MailGuard {
  readonly #options: SendLogOptions
  readonly #now: () => Date

  /**
   * @param options - log path, salt, and alerting.
   */
  constructor(options: SendLogOptions) {
    this.#options = options
    this.#now = options.now ?? (() => new Date())
  }

  /**
   * Record a delivery or a transport failure.
   * @param letter - the letter that was attempted.
   * @param outcome - the transport's verdict.
   */
  async afterSend(letter: Letter, outcome: SendOutcome): Promise<void> {
    const recipients = await this.#recipients([...letter.to, ...letter.cc ?? []])
    if (outcome.ok) {
      await this.#append({
        at: outcome.at,
        status: 'sent',
        transport: outcome.transport,
        messageId: outcome.messageId,
        from: letter.from,
        recipients,
        subject: letter.subject,
        ...(this.#options.actor === undefined ? {} : { actor: this.#options.actor }),
      })
      return
    }
    await this.#append({
      at: this.#now().toISOString(),
      status: 'failed',
      from: letter.from,
      recipients,
      subject: letter.subject,
      code: outcome.code,
      ...(outcome.scope === undefined ? {} : { scope: outcome.scope }),
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
      ...(this.#options.actor === undefined ? {} : { actor: this.#options.actor }),
    })
    await this.#options.alerter?.record(`${outcome.code}: ${outcome.message}`)
  }

  /**
   * Record a refused attempt, including one that never assembled a letter.
   * @param failure - the refusal.
   * @param context - what was known when the send stopped.
   */
  async onRefusal(failure: SendFailure, context: RefusalContext): Promise<void> {
    const addresses = context.letter === undefined
      ? recipientAddresses(context.request)
      : [...context.letter.to, ...context.letter.cc ?? []]
    const recipients = await this.#recipients(addresses)
    await this.#append({
      at: this.#now().toISOString(),
      status: 'refused',
      from: context.letter?.from ?? context.request.from ?? '',
      recipients,
      ...(context.letter === undefined ? {} : { subject: context.letter.subject }),
      code: failure.code,
      ...(failure.scope === undefined ? {} : { scope: failure.scope }),
      ...(failure.detail === undefined ? {} : { detail: failure.detail }),
      ...(this.#options.actor === undefined ? {} : { actor: this.#options.actor }),
    })
  }

  /**
   * Record a bounce reported by the relay's inbox.
   * @param bounce - the reported bounce.
   */
  async recordBounce(bounce: { messageId?: string; recipient: string; reason: string }): Promise<void> {
    await this.#append({
      at: this.#now().toISOString(),
      status: 'bounced',
      from: '',
      recipients: await this.#recipients([bounce.recipient]),
      ...(bounce.messageId === undefined ? {} : { messageId: bounce.messageId }),
      detail: bounce.reason,
      ...(this.#options.actor === undefined ? {} : { actor: this.#options.actor }),
    })
  }

  /** The log path this guard writes. */
  get logPath(): string {
    return this.#options.logPath
  }

  async #recipients(addresses: readonly string[]): Promise<string[]> {
    if (this.#options.exposeAddresses || this.#options.saltPath === undefined) return [...addresses]
    const salt = await ensureSalt(this.#options.saltPath)
    return addresses.map(address => hashRecipient(address, salt))
  }

  async #append(record: SendLogRecord): Promise<void> {
    await appendSendLogRecord(this.#options.logPath, record)
  }
}

/**
 * Recipients of a request that never became a letter.
 * @param request - the caller's request.
 * @returns the addresses, as far as they can be parsed.
 */
function recipientAddresses(request: SendRequest): string[] {
  const part = (value: string | readonly string[] | undefined): string[] => {
    if (value === undefined) return []
    const list = typeof value === 'string' ? value.split(',') : [...value]
    return list.map(entry => (/<([^<>]+)>/.exec(entry)?.[1] ?? entry).trim()).filter(entry => entry.length > 0)
  }
  return [...part(request.to), ...part(request.cc)]
}

/**
 * Read the log, oldest first.
 * @param path - log file path.
 * @param options - optional tail limit.
 * @returns the records; a missing file reads as empty.
 */
export async function readSendLog(path: string, options: { readonly limit?: number } = {}): Promise<SendLogRecord[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return []
  }
  const records: SendLogRecord[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      records.push(JSON.parse(line) as SendLogRecord)
    } catch {
      // A torn last line is ignored rather than crashing the reader.
    }
  }
  const limit = options.limit ?? 0
  return limit > 0 ? records.slice(-limit) : records
}

/** Counts an operator reads at a glance. */
export interface SendLogSummary {
  /** Total records. */
  readonly total: number
  /** Delivered letters. */
  readonly sent: number
  /** Transport failures. */
  readonly failed: number
  /** Refused attempts. */
  readonly refused: number
  /** Reported bounces. */
  readonly bounced: number
  /** Timestamp of the first record. */
  readonly first?: string
  /** Timestamp of the newest record. */
  readonly last?: string
  /** Letters delivered in the last 24 hours. */
  readonly last24h: number
  /** Refusals whose cause was a rate limit. */
  readonly rateLimited: number
  /** Rolling 24-hour breakdown, the shape `mail-status --json` reports. */
  readonly today: {
    readonly sent: number
    readonly failed: number
    readonly refused: number
    readonly rate_limited: number
    readonly bounced: number
  }
}

/**
 * Summarize a log file.
 * @param path - log file path.
 * @param options - clock override, for tests.
 * @returns the summary.
 */
export async function summarizeSendLog(path: string, options: { readonly now?: Date } = {}): Promise<SendLogSummary> {
  const records = await readSendLog(path)
  const now = (options.now ?? new Date()).getTime()
  const count = (status: SendLogRecord['status']): number => records.filter(record => record.status === status).length
  const dayAgo = now - 24 * 60 * 60 * 1000
  const today = records.filter(record => Date.parse(record.at) >= dayAgo)
  const todayStatus = (status: SendLogRecord['status']): number => today.filter(record => record.status === status).length
  const firstRecord = records[0]
  const lastRecord = records[records.length - 1]
  return {
    total: records.length,
    sent: count('sent'),
    failed: count('failed'),
    refused: count('refused'),
    bounced: count('bounced'),
    ...(firstRecord === undefined ? {} : { first: firstRecord.at }),
    ...(lastRecord === undefined ? {} : { last: lastRecord.at }),
    last24h: todayStatus('sent'),
    rateLimited: records.filter(record => record.status === 'refused' && record.code === 'rate_limited').length,
    today: {
      sent: todayStatus('sent'),
      failed: todayStatus('failed'),
      refused: todayStatus('refused'),
      rate_limited: today.filter(record => record.status === 'refused' && record.code === 'rate_limited').length,
      bounced: todayStatus('bounced'),
    },
  }
}

/**
 * Render a summary as one line an operator can read in a terminal.
 * @param summary - the summary.
 * @returns the formatted line.
 */
export function formatSendLogSummary(summary: SendLogSummary): string {
  const span = summary.first === undefined ? 'empty' : `${summary.first} → ${summary.last}`
  const { sent, failed, refused, rate_limited, bounced: todayBounced } = summary.today
  return `mail log: ${summary.total} records (${summary.sent} sent, ${summary.failed} failed, ${summary.refused} refused, ${summary.bounced} bounced), today sent=${sent} failed=${failed} refused=${refused} rate_limited=${rate_limited} bounced=${todayBounced}, ${span}`
}

/**
 * Rotate the log when it grows past a size or age cap.
 * @param path - log file path.
 * @param options - size and age caps.
 * @returns whether a rotation happened, and the archive name.
 */
export async function rotateSendLog(
  path: string,
  options: { readonly maxBytes?: number; readonly maxAgeDays?: number; readonly now?: Date } = {},
): Promise<{ rotated: boolean; archive?: string }> {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024
  const maxAgeDays = options.maxAgeDays ?? 30
  let info
  try {
    info = await stat(path)
  } catch {
    return { rotated: false }
  }
  const now = (options.now ?? new Date()).getTime()
  const tooBig = info.size > maxBytes
  const tooOld = now - info.mtimeMs > maxAgeDays * 24 * 60 * 60 * 1000
  if (!tooBig && !tooOld) return { rotated: false }
  const archive = `${path}.${new Date(now).toISOString().slice(0, 10)}.jsonl`
  await rename(path, archive)
  return { rotated: true, archive }
}

/**
 * A failure alerter with a dedup window: N failures produce exactly one alert.
 */
export class FailureAlerter {
  readonly #channel: (message: string) => Promise<void>
  readonly #threshold: number
  readonly #windowMs: number
  readonly #now: () => Date
  #failures: number[] = []
  #lastAlertAt = 0

  /**
   * @param options - channel, threshold, and window.
   */
  constructor(options: {
    readonly channel: (message: string) => Promise<void>
    readonly threshold?: number
    readonly windowMs?: number
    readonly now?: () => Date
  }) {
    this.#channel = options.channel
    this.#threshold = options.threshold ?? 3
    this.#windowMs = options.windowMs ?? 60 * 60 * 1000
    this.#now = options.now ?? (() => new Date())
  }

  /**
   * Record a failure.
   * @param message - a non-secret description of the failure.
   * @returns true when this call sent an alert.
   */
  async record(message: string): Promise<boolean> {
    const now = this.#now().getTime()
    this.#failures = this.#failures.filter(at => now - at < this.#windowMs)
    this.#failures.push(now)
    if (this.#failures.length < this.#threshold) return false
    if (now - this.#lastAlertAt < this.#windowMs) return false
    this.#lastAlertAt = now
    await this.#channel(`mail: ${this.#failures.length} failures within ${Math.round(this.#windowMs / 60000)} minutes; last: ${message}`)
    return true
  }
}

/** One aggregate row of a DMARC report. */
export interface DmarcRecord {
  /** Reporting domain. */
  readonly domain?: string
  /** Sending IP the receiver observed. */
  readonly sourceIp: string
  /** How many messages came from that IP. */
  readonly count: number
  /** What the receiver did: `none`, `quarantine`, or `reject`. */
  readonly disposition: string
  /** DKIM verdict on those messages. */
  readonly dkim: string
  /** SPF verdict on those messages. */
  readonly spf: string
}

/**
 * Extract the aggregate rows from one DMARC XML report.
 *
 * The parser is deliberately shallow: DMARC reports are flat, machine-written
 * XML, and a dependency-free regex walk over the `record` elements keeps the
 * package buildable with no new dependencies.
 * @param xml - the report text.
 * @returns one entry per `record` element.
 */
export function parseDmarcReport(xml: string): DmarcRecord[] {
  const records: DmarcRecord[] = []
  const domain = /<policy_published>[\s\S]*?<domain>([^<]+)<\/domain>/.exec(xml)?.[1]
  for (const match of xml.matchAll(/<record>([\s\S]*?)<\/record>/g)) {
    const body = match[1] ?? ''
    const sourceIp = /<source_ip>([^<]+)<\/source_ip>/.exec(body)?.[1]
    if (sourceIp === undefined) continue
    records.push({
      ...(domain === undefined ? {} : { domain }),
      sourceIp,
      count: Number(/<count>(\d+)<\/count>/.exec(body)?.[1] ?? '0'),
      disposition: /<disposition>([^<]+)<\/disposition>/.exec(body)?.[1] ?? 'none',
      dkim: /<dkim>([^<]+)<\/dkim>/.exec(body)?.[1] ?? 'unknown',
      spf: /<spf>([^<]+)<\/spf>/.exec(body)?.[1] ?? 'unknown',
    })
  }
  return records
}

/**
 * Read every DMARC report in a directory, plain or gzipped.
 * @param directory - where the reports were downloaded to.
 * @returns the aggregated rows.
 */
export async function readDmarcReports(directory: string): Promise<DmarcRecord[]> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return []
  }
  const records: DmarcRecord[] = []
  for (const name of names) {
    if (!name.endsWith('.xml') && !name.endsWith('.xml.gz')) continue
    const full = join(directory, name)
    const raw = await readFile(full)
    const xml = name.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
    records.push(...parseDmarcReport(xml))
  }
  return records
}

/**
 * Render a DMARC digest: one line per sending IP, plus totals.
 * @param records - aggregated rows.
 * @returns the digest text.
 */
export function formatDmarcDigest(records: readonly DmarcRecord[]): string {
  if (records.length === 0) return 'dmarc: no reports found'
  const byIp = new Map<string, { count: number; disposition: string; spf: number; dkim: number }>()
  for (const record of records) {
    const entry = byIp.get(record.sourceIp) ?? { count: 0, disposition: 'none', spf: 0, dkim: 0 }
    entry.count += record.count
    if (record.disposition !== 'none') entry.disposition = record.disposition
    if (record.spf === 'pass') entry.spf += record.count
    if (record.dkim === 'pass') entry.dkim += record.count
    byIp.set(record.sourceIp, entry)
  }
  const lines = [...byIp.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .map(([ip, entry]) => {
      const dmarc = entry.disposition === 'none' ? 'pass' : 'fail'
      return `${ip}: ${entry.count} message(s), spf=${entry.spf === entry.count ? 'pass' : 'fail'} dkim=${entry.dkim === entry.count ? 'pass' : 'fail'} dmarc=${dmarc}`
    })
  const total = records.reduce((sum, record) => sum + record.count, 0)
  return [`dmarc: ${records.length} aggregate rows, ${total} messages`, ...lines].join('\n')
}

/**
 * Open a log file as a read stream, for callers that want to tail it.
 * @param path - log file path.
 * @returns a read stream over the log file.
 */
export function openSendLog(path: string): ReturnType<typeof createReadStream> {
  return createReadStream(path, { encoding: 'utf8' })
}
