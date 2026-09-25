/**
 * The guard stack every host entry point uses.
 *
 * Order matters and is deliberate: limits refuse first, the send log then sees
 * both refusals and deliveries, and the audit chain records every attempt with
 * an actor. A host that wants fewer guards can still build its own list — the
 * seam takes any `MailGuard[]` — but the CLI and the MCP server share this one
 * so an operator reading either log sees the same events.
 * @module @deepseek-ai/dsh-mail/guards
 */

import { join } from 'node:path'
import type { MailGuard } from './seam.ts'
import type { MailConfig } from './types.ts'
import { RateLimiter, defaultVolumeLimits } from './limits.ts'
import type { VolumeLimits } from './limits.ts'
import { SendLog } from './sendlog.ts'
import type { FailureAlerter } from './sendlog.ts'
import { AuditLog } from './identity.ts'

/** Knobs a host sets when it builds the stack. */
export interface GuardStackOptions {
  /** Actor attributed to log and audit rows, e.g. `mcp:<session id>`. */
  readonly actor?: string
  /** Alert channel for repeated transport failures. */
  readonly alerter?: FailureAlerter
  /** Store full recipient addresses in the local log; off by default. */
  readonly exposeAddresses?: boolean
  /** Clock override, for tests. */
  readonly now?: () => Date
}

/**
 * Derive the volume caps from the configuration's day and hour limits, keeping
 * the finer-grained defaults for minute, per-recipient, and first-contact caps.
 * @param config - the effective configuration.
 * @returns caps for the limiter.
 */
export function limitsFromConfig(config: MailConfig): VolumeLimits {
  return {
    ...defaultVolumeLimits,
    perDay: config.limits.perDay,
    perHour: config.limits.perHour,
  }
}

/**
 * Build the standard guard stack for a configuration.
 * @param config - the effective configuration.
 * @param options - actor and alerting.
 * @returns guards in application order.
 */
export function buildGuards(config: MailConfig, options: GuardStackOptions = {}): readonly MailGuard[] {
  return [
    new RateLimiter({
      statePath: config.statePath,
      limits: limitsFromConfig(config),
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
    new SendLog({
      logPath: config.logPath,
      saltPath: join(config.dataDir, 'recipient-salt'),
      ...(options.actor === undefined ? {} : { actor: options.actor }),
      ...(options.exposeAddresses === undefined ? {} : { exposeAddresses: options.exposeAddresses }),
      ...(options.alerter === undefined ? {} : { alerter: options.alerter }),
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
    new AuditLog({
      path: join(config.dataDir, 'audit.log'),
      ...(options.actor === undefined ? {} : { actor: options.actor }),
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
  ]
}
