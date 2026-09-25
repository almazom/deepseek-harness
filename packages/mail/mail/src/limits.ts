/**
 * Volume limits: the caps that keep an agent-run mailer from becoming a spam
 * relay.
 *
 * The counters are derived from a rolling list of accepted sends rather than
 * from counters that get reset on a schedule. A rolling window cannot skip a
 * reset when the clock jumps backwards, which is what a naive "reset at
 * midnight" implementation does on the Mac Mini after a time change.
 * @module @deepseek-ai/dsh-mail/limits
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MailGuard, SendRequest } from './seam.ts'
import type { Letter, SendFailure, SendOutcome } from './types.ts'

/** Every volume cap this package enforces, all of them Config-typed. */
export interface VolumeLimits {
  /** Letters per rolling minute. */
  readonly perMinute: number
  /** Letters per rolling hour. */
  readonly perHour: number
  /** Letters per rolling 24 hours. */
  readonly perDay: number
  /** Letters addressed to the same recipient per rolling 24 hours. */
  readonly perRecipientPerDay: number
  /** Letters that address a recipient never seen before, per rolling hour. */
  readonly newRecipientPerHour: number
  /** Recipients in one letter above which an explicit batch flag is required. */
  readonly bulkRecipients: number
}

/** Defaults that fit a family server: chatty enough for agents, quiet enough to notice abuse. */
export const defaultVolumeLimits: VolumeLimits = {
  perMinute: 6,
  perHour: 40,
  perDay: 200,
  perRecipientPerDay: 5,
  newRecipientPerHour: 20,
  bulkRecipients: 5,
}

/** One accepted send, kept for the lifetime of the rolling windows. */
export interface RateRecord {
  /** ISO-8601 time the send was accepted. */
  readonly at: string
  /** Recipients of that send, as sent. */
  readonly recipients: readonly string[]
}

/** Persisted rate-limit state. */
export interface RateState {
  /** Schema version of the state file. */
  readonly version: 1
  /** Accepted sends, oldest first. */
  readonly records: readonly RateRecord[]
}

/** How long records are retained before they cannot affect any window. */
const RETENTION_MS = 48 * 60 * 60 * 1000

/**
 * Read the rate-limit state, tolerating a missing or unreadable file.
 * @param path - state file path.
 * @returns the state; an empty state when the file does not exist yet.
 */
export async function readRateState(path: string): Promise<RateState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return { version: 1, records: [] }
    const candidate = parsed as { version?: unknown; records?: unknown }
    if (candidate.version !== 1 || !Array.isArray(candidate.records)) return { version: 1, records: [] }
    return parsed as RateState
  } catch {
    return { version: 1, records: [] }
  }
}

/**
 * Write the state atomically, so a crash cannot leave a half-written counter.
 * @param path - state file path.
 * @param state - the state to persist.
 */
export async function writeRateState(path: string, state: RateState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

/**
 * Decide whether a letter fits inside the caps.
 *
 * Pure: it reads only the state it is given, so the same decision can be
 * replayed in a test with a fixed clock.
 * @param state - accepted sends so far.
 * @param recipients - recipients of the letter under test.
 * @param limits - the caps.
 * @param options - clock and the caller's bulk acknowledgement.
 * @returns `undefined` when the letter is admitted, else the refusal with scope and retry delay.
 */
export function checkLimits(
  state: RateState,
  recipients: readonly string[],
  limits: VolumeLimits = defaultVolumeLimits,
  options: { readonly now?: Date; readonly batch?: boolean } = {},
): SendFailure | undefined {
  const now = options.now ?? new Date()
  const nowMs = now.getTime()
  const within = (record: RateRecord, windowMs: number): boolean => {
    const at = Date.parse(record.at)
    if (Number.isNaN(at)) return false
    const age = nowMs - at
    // A record from the future (clock moved backwards) still counts: dropping it
    // would hand the caller a free window after a time change.
    return age < windowMs
  }
  const recent = state.records.filter(record => within(record, RETENTION_MS))
  const lettersIn = (windowMs: number): RateRecord[] => recent.filter(record => within(record, windowMs))
  const retryAfter = (records: readonly RateRecord[], windowMs: number): number => {
    if (records.length === 0) return 1
    const oldest = Math.min(...records.map(record => Date.parse(record.at)))
    return Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000))
  }

  if (recipients.length > limits.bulkRecipients && !options.batch) {
    return {
      ok: false,
      code: 'rate_limited',
      scope: 'bulk',
      detail: String(recipients.length),
      message: `rate_limited: ${recipients.length} recipients exceed the bulk threshold of ${limits.bulkRecipients}; pass the batch flag to acknowledge a bulk send`,
    }
  }
  const minute = lettersIn(60_000)
  if (minute.length >= limits.perMinute) {
    return {
      ok: false,
      code: 'rate_limited',
      scope: 'per-minute',
      retryAfterSeconds: retryAfter(minute, 60_000),
      message: `rate_limited: ${minute.length} letters in the last minute reach the cap of ${limits.perMinute}`,
    }
  }
  const hour = lettersIn(60 * 60 * 1000)
  if (hour.length >= limits.perHour) {
    return {
      ok: false,
      code: 'rate_limited',
      scope: 'per-hour',
      retryAfterSeconds: retryAfter(hour, 60 * 60 * 1000),
      message: `rate_limited: ${hour.length} letters in the last hour reach the cap of ${limits.perHour}`,
    }
  }
  const day = lettersIn(24 * 60 * 60 * 1000)
  if (day.length >= limits.perDay) {
    return {
      ok: false,
      code: 'rate_limited',
      scope: 'per-day',
      retryAfterSeconds: retryAfter(day, 24 * 60 * 60 * 1000),
      message: `rate_limited: ${day.length} letters in the last 24 hours reach the cap of ${limits.perDay}`,
    }
  }

  const previousRecipients = new Set(recent.flatMap(record => [...record.recipients]))
  const dayRecipients = new Map<string, number>()
  for (const record of day) {
    for (const recipient of record.recipients) {
      dayRecipients.set(recipient, (dayRecipients.get(recipient) ?? 0) + 1)
    }
  }
  for (const recipient of recipients) {
    const count = dayRecipients.get(recipient) ?? 0
    if (count >= limits.perRecipientPerDay) {
      return {
        ok: false,
        code: 'rate_limited',
        scope: 'per-recipient',
        detail: recipient,
        retryAfterSeconds: retryAfter(day, 24 * 60 * 60 * 1000),
        message: `rate_limited: "${recipient}" already received ${count} letters in the last 24 hours (cap ${limits.perRecipientPerDay})`,
      }
    }
  }
  const knownBeforeHour = new Set(
    state.records
      .filter(record => !within(record, 60 * 60 * 1000))
      .flatMap(record => [...record.recipients]),
  )
  const recentFirstContacts = new Set(
    hour.flatMap(record => [...record.recipients]).filter(recipient => !knownBeforeHour.has(recipient)),
  )
  const unknown = recipients.filter(recipient => !previousRecipients.has(recipient))
  if (unknown.length > 0) {
    const newAfterSend = recentFirstContacts.size + unknown.length
    if (newAfterSend > limits.newRecipientPerHour) {
      const firstUnknown = unknown[0]
      return {
        ok: false,
        code: 'rate_limited',
        scope: 'new-recipient',
        ...(firstUnknown === undefined ? {} : { detail: firstUnknown }),
        retryAfterSeconds: retryAfter(hour.length > 0 ? hour : recent, 60 * 60 * 1000),
        message: `rate_limited: "${unknown[0]}" would be a new recipient beyond the ${limits.newRecipientPerHour}-per-hour first-contact allowance`,
      }
    }
  }
  return undefined
}

/** Construction knobs for {@link RateLimiter}. */
export interface RateLimiterOptions {
  /** State file path. */
  readonly statePath: string
  /** Caps to enforce. */
  readonly limits?: VolumeLimits
  /** Clock override, for tests. */
  readonly now?: () => Date
}

/**
 * The guard that applies {@link checkLimits} before a send and records the send
 * after it.
 *
 * One process is assumed to own the state file; two concurrent mailers would
 * each see a stale count, which is acceptable for a single family host and is
 * called out in the README rather than hidden behind a lock.
 */
export class RateLimiter implements MailGuard {
  readonly #statePath: string
  readonly #limits: VolumeLimits
  readonly #now: () => Date

  /**
   * @param options - state path, caps, and clock.
   */
  constructor(options: RateLimiterOptions) {
    this.#statePath = options.statePath
    this.#limits = options.limits ?? defaultVolumeLimits
    this.#now = options.now ?? (() => new Date())
  }

  /**
   * Refuse the letter when a cap is already reached.
   * @param letter - the assembled letter.
   * @param rendered - the serialized message; unused by this guard.
   * @param request - the caller's request, which may carry the batch flag.
   * @returns `undefined` when admitted.
   */
  async beforeSend(letter: Letter, rendered: unknown, request?: SendRequest): Promise<SendFailure | undefined> {
    void rendered
    const state = await readRateState(this.#statePath)
    const recipients = [...letter.to, ...letter.cc ?? []]
    return checkLimits(state, recipients, this.#limits, {
      now: this.#now(),
      ...(request?.batch === undefined ? {} : { batch: request.batch }),
    })
  }

  /**
   * Record an accepted send, pruning anything no window can still see.
   * @param letter - the letter that was accepted.
   * @param outcome - the transport's verdict.
   */
  async afterSend(letter: Letter, outcome: SendOutcome): Promise<void> {
    if (!outcome.ok) return
    const state = await readRateState(this.#statePath)
    const cutoff = this.#now().getTime() - RETENTION_MS
    const records = state.records.filter(record => Date.parse(record.at) >= cutoff)
    records.push({ at: this.#now().toISOString(), recipients: [...letter.to, ...letter.cc ?? []] })
    await writeRateState(this.#statePath, { version: 1, records })
  }

  /**
   * Current counts, for `mail-status`.
   * @returns the counts recorded in the rolling hour and day windows.
   */
  async counts(): Promise<{ hour: number; day: number }> {
    const state = await readRateState(this.#statePath)
    const now = this.#now().getTime()
    const since = (ms: number): number => state.records.filter(record => now - Date.parse(record.at) < ms).length
    return { hour: since(60 * 60 * 1000), day: since(24 * 60 * 60 * 1000) }
  }
}
