/**
 * Public types of the Mac Mini mail server.
 *
 * This module holds types only — no runtime code — so every consumer (CLI, MCP
 * server, tests, host plugins) shares one vocabulary for a letter, a transport,
 * and the structured outcome of a send.
 * @module @deepseek-ai/dsh-mail/types
 */

import type { AttachmentLimits } from './attachments.ts'

/** How a letter leaves the host: `console` prints it, `smtp` submits it to a relay. */
export type Transport = 'console' | 'smtp'

/** Resolved relay credentials; never logged, never persisted by this package. */
export interface SmtpCredentials {
  /** Relay host name. */
  readonly host: string
  /** Submission port: 465 is implicit TLS, anything else negotiates STARTTLS. */
  readonly port: number
  /** Submission login. */
  readonly user: string
  /** Submission password or app password. */
  readonly password: string
}

/** Where a resolved credential came from, for diagnostics that print no secret. */
export type CredentialSource = 'env' | 'store' | 'none'

/** Result of resolving relay credentials: a value plus where it came from. */
export interface CredentialLoad {
  /** The credentials, absent when neither layer carries a complete set. */
  readonly credentials?: SmtpCredentials
  /** The winning layer, `none` when nothing resolved. */
  readonly source: CredentialSource
  /** What is missing or wrong, phrased without any secret value. */
  readonly problem?: string
}

/** One outbound attachment, already read into memory. */
export interface Attachment {
  /** File name shown to the recipient. */
  readonly filename: string
  /** Raw bytes. */
  readonly content: Uint8Array
  /** MIME type; inferred from the file name when omitted. */
  readonly contentType?: string
}

/** One letter, fully assembled — the unit this package either sends whole or not at all. */
export interface Letter {
  /** Envelope and header sender; must be one of the configured identities. */
  readonly from: string
  /** Primary recipients. */
  readonly to: readonly string[]
  /** Carbon-copy recipients. */
  readonly cc?: readonly string[]
  /** Reply-To header, when the operator wants answers elsewhere. */
  readonly replyTo?: string
  /** Subject line. */
  readonly subject: string
  /** Plain-text body. */
  readonly text: string
  /** Optional HTML alternative. */
  readonly html?: string
  /** Attachments, already within policy. */
  readonly attachments?: readonly Attachment[]
  /** Extra headers, applied last. */
  readonly headers?: Readonly<Record<string, string>>
}

/** Why a send did not happen; the values are the stable wire codes callers branch on. */
export type SendErrorCode =
  | 'config'
  | 'credentials'
  | 'recipients'
  | 'rate_limited'
  | 'attachment_too_large'
  | 'attachment_type_blocked'
  | 'policy_blocked'
  | 'identity_not_allowed'
  | 'assembly'
  | 'transport'

/** A send that did not happen; `message` never contains a secret. */
export interface SendFailure {
  /** Discriminator. */
  readonly ok: false
  /** Machine-readable reason. */
  readonly code: SendErrorCode
  /** Human-readable reason. */
  readonly message: string
  /** Which cap or rule refused the letter, when a rule is scope-bound. */
  readonly scope?: string
  /** Seconds the caller should wait before retrying, when a delay is known. */
  readonly retryAfterSeconds?: number
  /** Extra structured detail, e.g. the offending file name. */
  readonly detail?: string
}

/** A send the transport accepted. */
export interface SendSuccess {
  /** Discriminator. */
  readonly ok: true
  /** Transport that carried the letter. */
  readonly transport: Transport
  /** Message-ID of the assembled letter. */
  readonly messageId: string
  /** Recipients the transport accepted. */
  readonly accepted: readonly string[]
  /** Envelope sender. */
  readonly from: string
  /** ISO-8601 timestamp of the accepted send. */
  readonly at: string
}

/** Outcome of one send. */
export type SendOutcome = SendSuccess | SendFailure

/** Who may receive mail: an explicit allow list plus an explicit deny list. */
export interface RecipientPolicy {
  /** Allowed addresses or `@domain` suffixes; empty means "everyone, unless denied". */
  readonly allow: readonly string[]
  /** Always-refused addresses or `@domain` suffixes. */
  readonly deny: readonly string[]
}

/** Outbound volume caps, enforced per rolling window. */
export interface RateLimits {
  /** Letters per rolling 24 hours. */
  readonly perDay: number
  /** Letters per rolling hour. */
  readonly perHour: number
}

/** Effective configuration of one mail run. */
export interface MailConfig {
  /** Selected transport; `console` unless configuration says otherwise. */
  readonly transport: Transport
  /** Default sender; the first identity unless overridden. */
  readonly from: string
  /** Sender identities this host is allowed to use. */
  readonly identities: readonly string[]
  /** Credentials document consulted for relay secrets. */
  readonly credentialsPath: string
  /** JSONL delivery log. */
  readonly logPath: string
  /** JSON rate-limit state. */
  readonly statePath: string
  /** Working directory for previews and scratch output. */
  readonly dataDir: string
  /** Recipient policy. */
  readonly policy: RecipientPolicy
  /** Volume caps. */
  readonly limits: RateLimits
  /** Attachment caps; defaults when unset. */
  readonly attachmentLimits?: AttachmentLimits
}
