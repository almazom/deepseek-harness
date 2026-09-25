/**
 * Sender identities and the tamper-evident audit trail.
 *
 * Two rules make an agent-run mailer accountable. A letter may only leave from
 * an address on the configured roster, and every attempt — delivered, failed,
 * or refused — lands in an append-only log whose entries chain by hash, so a
 * deleted or edited line is detectable after the fact.
 * @module @deepseek-ai/dsh-mail/identity
 */

import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MailGuard, RefusalContext } from './seam.ts'
import type { Letter, SendFailure, SendOutcome, Transport } from './types.ts'

/** The addresses this host may send as. */
export interface IdentityRoster {
  /** Every allowed sender address. */
  readonly identities: readonly string[]
  /** The sender used when a request names none. */
  readonly defaultIdentity: string
}

/**
 * Who is asking, as far as the host can tell: the shell user, or an MCP session
 * identifier when one was provided.
 * @param sessionId - an MCP session id, when the caller has one.
 * @returns the actor string recorded in the audit trail.
 */
export function defaultActor(sessionId?: string): string {
  if (sessionId !== undefined && sessionId.length > 0) return `mcp:${sessionId}`
  return `user:${process.env.USER ?? process.env.LOGNAME ?? 'unknown'}`
}

/**
 * Decide whether a requested sender is on the roster.
 * @param requested - the request's sender, when it named one.
 * @param roster - the configured roster.
 * @returns the sender to use, or the refusal.
 */
export function resolveSender(
  requested: string | undefined,
  roster: IdentityRoster,
): { ok: true; from: string } | SendFailure {
  const from = requested ?? roster.defaultIdentity
  if (from.length === 0) {
    return { ok: false, code: 'identity_not_allowed', scope: 'roster', message: 'identity_not_allowed: no sender identity is configured' }
  }
  if (roster.identities.length > 0 && !roster.identities.includes(from)) {
    return {
      ok: false,
      code: 'identity_not_allowed',
      scope: 'roster',
      detail: from,
      message: `identity_not_allowed: "${from}" is not on the sender roster (${roster.identities.join(', ')})`,
    }
  }
  return { ok: true, from }
}

/** What the audit trail records about one attempt. */
export interface AuditEvent {
  /** ISO-8601 timestamp. */
  readonly at: string
  /** Attempt class: delivered, transport failure, or blocked before a transport. */
  readonly action: 'send' | 'send_failed' | 'send_blocked'
  /** Who asked for it. */
  readonly actor: string
  /** Envelope sender, when one was resolved. */
  readonly from: string
  /** Recipients, as resolved at the time of the attempt. */
  readonly recipients: readonly string[]
  /** Subject, which is metadata rather than content. */
  readonly subject?: string
  /** Message-ID, when a letter was rendered. */
  readonly messageId?: string
  /** Transport that handled the attempt. */
  readonly transport?: Transport
  /** Refusal code, for a blocked or failed attempt. */
  readonly code?: string
  /** Rule scope that refused the letter. */
  readonly scope?: string
  /** Extra detail: a file name, a recipient, a count. */
  readonly detail?: string
}

/** One chained line of the audit log. */
export interface AuditEntry {
  /** 1-based position in the chain. */
  readonly seq: number
  /** Hash of the previous line; empty for the first. */
  readonly prev: string
  /** Hash of this line's payload chained to `prev`. */
  readonly hash: string
  /** The recorded event. */
  readonly payload: AuditEvent
}

/**
 * Deterministic JSON, so a hash can be recomputed byte for byte.
 * @param value - any JSON value.
 * @returns the canonical text.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (value === undefined) return 'null'
    const text: unknown = JSON.stringify(value)
    return typeof text === 'string' ? text : 'null'
  }
  if (Array.isArray(value)) return `[${value.map(entry => canonicalJson(entry)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([name, entry]) => `${JSON.stringify(name)}:${canonicalJson(entry)}`).join(',')}}`
}

/**
 * Chain one event onto the previous hash.
 * @param prev - the previous line's hash, or an empty string.
 * @param payload - the event.
 * @returns the hash for this line.
 */
export function auditHash(prev: string, payload: AuditEvent): string {
  return createHash('sha256').update(`${prev}\n${canonicalJson(payload)}`).digest('hex')
}

/**
 * Read the audit log, oldest first.
 * @param path - audit log path.
 * @param options - optional tail limit.
 * @returns the entries; a missing file reads as empty.
 */
export async function readAuditLog(path: string, options: { readonly limit?: number } = {}): Promise<AuditEntry[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return []
  }
  const entries: AuditEntry[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      entries.push(JSON.parse(line) as AuditEntry)
    } catch {
      // A torn last line is ignored; `verifyAuditChain` still reports the tail it can read.
    }
  }
  const limit = options.limit ?? 0
  return limit > 0 ? entries.slice(-limit) : entries
}

/**
 * Recompute the chain and report the first line that does not add up.
 * @param path - audit log path.
 * @returns whether the chain is intact, and where it broke.
 */
export async function verifyAuditChain(path: string): Promise<{ ok: boolean; entries: number; brokenAt?: number }> {
  const entries = await readAuditLog(path)
  let prev = ''
  for (const [index, entry] of entries.entries()) {
    const expected = auditHash(prev, entry.payload)
    if (entry.prev !== prev || entry.hash !== expected) {
      return { ok: false, entries: entries.length, brokenAt: entry.seq > 0 ? entry.seq : index + 1 }
    }
    prev = entry.hash
  }
  return { ok: true, entries: entries.length }
}

/** Construction knobs for {@link AuditLog}. */
export interface AuditLogOptions {
  /** Audit log path. */
  readonly path: string
  /** Actor attributed to every entry. */
  readonly actor?: string
  /** Clock override, for tests. */
  readonly now?: () => Date
}

/**
 * The guard that writes the chained audit trail.
 *
 * It chains on write, so the file stays verifiable without a separate signing
 * step; the previous hash is read from the tail of the file each time.
 */
export class AuditLog implements MailGuard {
  readonly #path: string
  readonly #actor: string
  readonly #now: () => Date

  /**
   * @param options - audit path and actor.
   */
  constructor(options: AuditLogOptions) {
    this.#path = options.path
    this.#actor = options.actor ?? defaultActor()
    this.#now = options.now ?? (() => new Date())
  }

  /** The audit path this guard writes. */
  get path(): string {
    return this.#path
  }

  /**
   * Record a delivered letter or a transport failure.
   * @param letter - the letter that was attempted.
   * @param outcome - the transport's verdict.
   */
  async afterSend(letter: Letter, outcome: SendOutcome): Promise<void> {
    const base = {
      actor: this.#actor,
      from: letter.from,
      recipients: [...letter.to, ...letter.cc ?? []],
      subject: letter.subject,
    }
    if (outcome.ok) {
      await this.#append({
        at: outcome.at,
        action: 'send',
        ...base,
        messageId: outcome.messageId,
        transport: outcome.transport,
      })
      return
    }
    await this.#append({
      at: this.#now().toISOString(),
      action: 'send_failed',
      ...base,
      code: outcome.code,
      ...(outcome.scope === undefined ? {} : { scope: outcome.scope }),
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
    })
  }

  /**
   * Record an attempt that never reached a transport.
   * @param failure - the refusal.
   * @param context - what was known when the send stopped.
   */
  async onRefusal(failure: SendFailure, context: RefusalContext): Promise<void> {
    const recipients = context.letter === undefined
      ? []
      : [...context.letter.to, ...context.letter.cc ?? []]
    await this.#append({
      at: this.#now().toISOString(),
      action: 'send_blocked',
      actor: this.#actor,
      from: context.letter?.from ?? context.request.from ?? '',
      recipients,
      ...(context.letter === undefined ? {} : { subject: context.letter.subject }),
      code: failure.code,
      ...(failure.scope === undefined ? {} : { scope: failure.scope }),
      ...(failure.detail === undefined ? {} : { detail: failure.detail }),
    })
  }

  async #append(payload: AuditEvent): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 })
    const entries = await readAuditLog(this.#path)
    const prev = entries.at(-1)?.hash ?? ''
    const entry: AuditEntry = {
      seq: entries.length + 1,
      prev,
      hash: auditHash(prev, payload),
      payload,
    }
    await appendFile(this.#path, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  }
}
