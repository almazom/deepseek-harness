/**
 * Configuration resolution for `@deepseek-ai/dsh-mail`.
 *
 * The transport is chosen here and nowhere else: no module branches on
 * `MSH_TRANSPORT` inline, so a test can hold one resolved {@link MailConfig} and
 * know exactly what the package will do. Defaults are materialized in a single
 * step rather than sprinkled through the call graph.
 * @module @deepseek-ai/dsh-mail/config
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { MailConfig, RateLimits, RecipientPolicy, Transport } from './types.ts'
import { defaultAttachmentLimits } from './attachments.ts'

/** Harness home directory name inside the user's home. */
const DSH_HOME_DIR = '.dsh'

/**
 * Default sender when nothing is configured.
 *
 * It only ever appears on the `console` transport, where nothing leaves the
 * host; a real relay gets its own identity through `MSH_FROM`.
 */
export const DEFAULT_IDENTITY = 'dsh-mail@dsh.local'

/** Default daily and hourly caps — deliberately low for a family server. */
const DEFAULT_LIMITS: RateLimits = { perDay: 200, perHour: 40 }

/** Default policy: send to anyone, except the obviously wrong local names. */
const DEFAULT_POLICY: RecipientPolicy = { allow: [], deny: [] }

/** The subset of the environment this module reads. */
export interface MailEnvironment {
  /** Environment variables, `process.env` in production. */
  readonly [name: string]: string | undefined
}

/**
 * Split a comma-separated list, trimming blanks.
 * @param raw - the raw value, possibly empty or absent.
 * @returns the parsed entries.
 */
function splitList(raw: string | undefined): string[] {
  if (raw === undefined) return []
  return raw.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0)
}

/**
 * Parse a positive integer setting, falling back to the given default.
 * @param raw - the raw value.
 * @param fallback - value used when parsing fails or the number is not positive.
 * @returns the effective number.
 */
function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Read the transport selector, defaulting to `console` so an unconfigured host
 * never mails a stranger by accident.
 * @param raw - the `MSH_TRANSPORT` value.
 * @returns the selected transport.
 * @throws TypeError when the value is neither `console` nor `smtp`.
 */
export function parseTransport(raw: string | undefined): Transport {
  if (raw === undefined || raw === '' || raw === 'console') return 'console'
  if (raw === 'smtp') return 'smtp'
  throw new TypeError(`mail: MSH_TRANSPORT must be "console" or "smtp", received ${JSON.stringify(raw)}`)
}

/**
 * Resolve the effective configuration for this run.
 * @param env - environment variables; defaults to `process.env`.
 * @param home - user home directory; defaults to the OS home.
 * @returns the fully defaulted configuration.
 */
export function resolveConfig(env: MailEnvironment = process.env, home: string = homedir()): MailConfig {
  const dshHome = env['DSH_HOME'] ?? join(home, DSH_HOME_DIR)
  const identities = splitList(env['MSH_IDENTITIES'])
  const from = env['MSH_FROM'] ?? identities[0] ?? DEFAULT_IDENTITY
  return {
    transport: parseTransport(env['MSH_TRANSPORT']),
    from,
    identities: identities.length > 0 ? identities : [from],
    credentialsPath: env['MSH_CREDENTIALS'] ?? join(dshHome, '.credentials.yaml'),
    logPath: env['MSH_LOG'] ?? join(dshHome, 'mail', 'send-log.jsonl'),
    statePath: env['MSH_STATE'] ?? join(dshHome, 'mail', 'rate-state.json'),
    dataDir: env['MSH_DATA_DIR'] ?? join(dshHome, 'mail'),
    policy: {
      allow: splitList(env['MSH_ALLOW']),
      deny: splitList(env['MSH_DENY']),
    },
    limits: {
      perDay: positiveInt(env['MSH_MAX_PER_DAY'], DEFAULT_LIMITS.perDay),
      perHour: positiveInt(env['MSH_MAX_PER_HOUR'], DEFAULT_LIMITS.perHour),
    },
    attachmentLimits: {
      ...defaultAttachmentLimits,
      maxCount: positiveInt(env['MSH_MAX_ATTACHMENTS'], defaultAttachmentLimits.maxCount),
      maxBytesPerFile: positiveInt(env['MSH_MAX_ATTACHMENT_BYTES'], defaultAttachmentLimits.maxBytesPerFile),
      maxTotalBytes: positiveInt(env['MSH_MAX_ATTACHMENT_TOTAL_BYTES'], defaultAttachmentLimits.maxTotalBytes),
    },
  }
}

/** {@link DEFAULT_POLICY}, exported for tests and documentation. */
export const defaultPolicy: RecipientPolicy = DEFAULT_POLICY

/** {@link DEFAULT_LIMITS}, exported for tests and documentation. */
export const defaultLimits: RateLimits = DEFAULT_LIMITS
