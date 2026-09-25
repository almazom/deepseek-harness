/**
 * The mail seam: one place where a letter is assembled, validated, and handed
 * to a transport.
 *
 * Two invariants define this module. First, the transport is chosen from
 * configuration alone — no seam caller sprinkles `if (env)` branches, and an
 * unconfigured host stays on `console`, so a stray call cannot mail a stranger.
 * Second, assembly is atomic: everything is validated and rendered in memory
 * before a transport sees a byte, so a failure returns a structured
 * `send_failed` and never a half-letter.
 * @module @deepseek-ai/dsh-mail/seam
 */

import { loadSmtpCredentials } from './credentials.ts'
import { validateAttachments } from './attachments.ts'
import { dotStuff, describeAttachment, previewHeaders, renderLetter, type RenderedLetter } from './mime.ts'
import { sendViaSmtp, SmtpError, type SmtpDialer } from './smtp.ts'
import type {
  Attachment,
  Letter,
  MailConfig,
  RecipientPolicy,
  SendFailure,
  SendOutcome,
  SmtpCredentials,
  Transport,
} from './types.ts'

/** Default per-step timeout for a relay conversation. */
export const DEFAULT_SMTP_TIMEOUT_MS = 20_000

/** A letter request as callers (CLI, MCP, other services) express it. */
export interface SendRequest {
  /** Primary recipients: one address, a comma-separated string, or a list. */
  readonly to: string | readonly string[]
  /** Carbon-copy recipients. */
  readonly cc?: string | readonly string[]
  /** Subject line; must not contain a line break. */
  readonly subject: string
  /** Plain-text body. */
  readonly text: string
  /** Optional HTML body; rendered as an alternative part. */
  readonly html?: string
  /** Sender; defaults to the configured default identity. */
  readonly from?: string
  /** Reply-To address. */
  readonly replyTo?: string
  /** Attachments, subject to {@link validateAttachments}. */
  readonly attachments?: readonly Attachment[]
  /** Extra headers; structural headers are refused because assembly owns them. */
  readonly headers?: Readonly<Record<string, string>>
  /** Explicit acknowledgement of a bulk recipient count, checked by the rate limiter. */
  readonly batch?: boolean
}

/** A letter together with its serialized form. */
export interface PreparedLetter {
  /** The validated letter. */
  readonly letter: Letter
  /** The serialized message. */
  readonly rendered: RenderedLetter
}

/** Headers assembly owns, so a caller cannot forge or duplicate them. */
const RESERVED_HEADERS: readonly string[] = [
  'bcc', 'cc', 'content-transfer-encoding', 'content-type', 'date', 'from',
  'message-id', 'mime-version', 'reply-to', 'subject', 'to',
]

/**
 * Extract one address from `Name <address>` or a bare address.
 * @param raw - the raw recipient text.
 * @returns the address, trimmed.
 */
function addressOf(raw: string): string {
  const angled = /<([^<>]+)>/.exec(raw)
  return (angled?.[1] ?? raw).trim()
}

/**
 * Accept the two shapes callers actually produce, and nothing creative.
 * @param value - an address, a comma-separated string, or a list.
 * @returns the addresses in order.
 */
export function parseRecipients(value: string | readonly string[]): string[] {
  const parts = typeof value === 'string' ? value.split(',') : [...value]
  return parts.map(entry => addressOf(entry)).filter(entry => entry.length > 0)
}

/**
 * Whether an address is syntactically mailable, and free of header injection.
 * @param address - the address.
 * @returns true when the address looks usable.
 */
export function isAddress(address: string): boolean {
  if (/[\s,;<>]/.test(address)) return false
  const at = address.indexOf('@')
  if (at <= 0 || at !== address.lastIndexOf('@')) return false
  const domain = address.slice(at + 1)
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

/**
 * Match one address against one policy pattern.
 *
 * Supported forms: `*` (everything), `*@domain`, a bare `domain` (matches any
 * local part at that domain), and an exact address.
 * @param address - the address under test.
 * @param pattern - the configured pattern.
 * @returns true when the pattern covers the address.
 */
export function matchesPattern(address: string, pattern: string): boolean {
  const trimmed = pattern.trim().toLowerCase()
  const candidate = address.toLowerCase()
  if (trimmed === '*') return true
  if (trimmed.startsWith('*@')) return candidate.endsWith(trimmed.slice(1))
  if (!trimmed.includes('@')) return candidate.endsWith(`@${trimmed.replace(/^@/, '')}`)
  return candidate === trimmed
}

/**
 * Apply the recipient policy: the allow list admits, the deny list refuses.
 * @param recipients - the resolved recipients.
 * @param policy - the configured policy.
 * @returns `undefined` when every recipient is admitted, else the refusal.
 */
export function checkPolicy(recipients: readonly string[], policy: RecipientPolicy): SendFailure | undefined {
  const allow = policy.allow.map(entry => entry.trim()).filter(entry => entry.length > 0)
  const deny = policy.deny.map(entry => entry.trim()).filter(entry => entry.length > 0)
  for (const recipient of recipients) {
    if (deny.some(pattern => matchesPattern(recipient, pattern))) {
      return { ok: false, code: 'policy_blocked', scope: 'deny', message: `recipients: "${recipient}" is on the deny list` }
    }
    if (allow.length > 0 && !allow.some(pattern => matchesPattern(recipient, pattern))) {
      return { ok: false, code: 'policy_blocked', scope: 'allow', message: `recipients: "${recipient}" is not on the allow list` }
    }
  }
  return undefined
}

/**
 * Validate and normalize a request into a letter.
 *
 * This is the whole admission decision: recipients, identity, subject, headers,
 * and attachment limits. It reads nothing from the host and sends nothing.
 * @param request - the caller's request.
 * @param config - the resolved configuration.
 * @returns the letter, or the first refusal that applies.
 */
export function assembleLetter(request: SendRequest, config: MailConfig): { ok: true; letter: Letter } | SendFailure {
  const to = parseRecipients(request.to)
  const cc = request.cc === undefined ? [] : parseRecipients(request.cc)
  if (to.length === 0) return { ok: false, code: 'recipients', message: 'recipients: at least one "to" address is required' }
  for (const address of [...to, ...cc]) {
    if (!isAddress(address)) return { ok: false, code: 'recipients', message: `recipients: "${address}" is not a usable address` }
  }
  const from = request.from ?? config.from
  if (!isAddress(from)) return { ok: false, code: 'config', message: `config: sender "${from}" is not a usable address` }
  if (config.identities.length > 0 && !config.identities.includes(from)) {
    return {
      ok: false,
      code: 'identity_not_allowed',
      scope: 'from',
      message: `config: sender "${from}" is not one of the configured identities (${config.identities.join(', ')})`,
      detail: from,
    }
  }
  if (/[\r\n]/.test(request.subject)) {
    return { ok: false, code: 'assembly', message: 'assembly: the subject must be a single line' }
  }
  if (request.subject.length > 998) {
    return { ok: false, code: 'assembly', message: 'assembly: the subject exceeds 998 characters' }
  }
  for (const name of Object.keys(request.headers ?? {})) {
    const lower = name.toLowerCase()
    if (RESERVED_HEADERS.includes(lower)) {
      return { ok: false, code: 'assembly', message: `assembly: header "${name}" is owned by assembly and cannot be overridden` }
    }
  }
  const attachments = request.attachments ?? []
  const attachmentFailure = validateAttachments(attachments, config.attachmentLimits)
  if (attachmentFailure !== undefined) return attachmentFailure
  const policyFailure = checkPolicy([...to, ...cc], config.policy)
  if (policyFailure !== undefined) return policyFailure

  const letter: Letter = {
    from,
    to,
    subject: request.subject,
    text: request.text,
    ...(cc.length > 0 ? { cc } : {}),
    ...(request.replyTo === undefined ? {} : { replyTo: request.replyTo }),
    ...(request.html === undefined ? {} : { html: request.html }),
    ...(attachments.length === 0 ? {} : { attachments }),
    ...(request.headers === undefined ? {} : { headers: request.headers }),
  }
  return { ok: true, letter }
}

/** What a transport needs beyond the letter itself. */
export interface TransportContext {
  /** The resolved configuration. */
  readonly config: MailConfig
  /** Relay credentials, resolved by the mailer before the send. */
  readonly credentials?: SmtpCredentials
  /** Dialer override, for tests. */
  readonly dialer?: SmtpDialer
}

/** One delivery mechanism behind the seam. */
export interface MailTransport {
  /** The name this transport answers for in {@link MailConfig}. */
  readonly name: Transport
  /** The transport's own name for diagnostics. */
  readonly label: string
  /**
   * Deliver an assembled letter.
   * @param prepared - the letter and its serialized form.
   * @param context - configuration and credentials.
   * @returns the outcome; never throws for a delivery failure.
   */
  send(prepared: PreparedLetter, context: TransportContext): Promise<SendOutcome>
}

/**
 * A guard consulted before and after each send, for the rate limiter and the
 * send log. The seam does not implement policy itself.
 */
export interface MailGuard {
  /**
   * Refuse the send, or return `undefined` to proceed.
   * @param letter - the assembled letter.
   * @param rendered - the serialized message.
   * @param request - the caller's original request, for flags it carries.
   * @returns a refusal, when the guard denies the send.
   */
  beforeSend?(letter: Letter, rendered: RenderedLetter, request: SendRequest): Promise<SendFailure | undefined>
  /**
   * Record the outcome; failures here are reported, never retried.
   * @param letter - the letter that was sent.
   * @param outcome - what the transport reported.
   */
  afterSend?(letter: Letter, outcome: SendOutcome): Promise<void>
  /**
   * Observe a send that never reached a transport — a refused letter is still
   * an attempt, so the audit trail can account for it.
   * @param failure - the refusal.
   * @param context - whatever was assembled before the refusal.
   */
  onRefusal?(failure: SendFailure, context: RefusalContext): Promise<void>
}

/** What was known about a letter at the moment it was refused. */
export interface RefusalContext {
  /** The caller's original request. */
  readonly request: SendRequest
  /** The assembled letter, when assembly succeeded. */
  readonly letter?: Letter
  /** The serialized message, when rendering had happened. */
  readonly rendered?: RenderedLetter
}

/**
 * The development transport: print the letter and admit it went nowhere.
 *
 * Console delivery is a real success for callers — a dry run that returns a
 * failure would teach agents to retry, and retrying a dry run is pointless.
 */
export class ConsoleTransport implements MailTransport {
  readonly name: Transport = 'console'
  readonly label = 'console transport'
  readonly #write: (text: string) => void

  /**
   * @param write - sink for the preview; defaults to stdout.
   */
  constructor(write: (text: string) => void = (text) => { process.stdout.write(text) }) {
    this.#write = write
  }

  /**
   * Print the letter exactly as a human would read it.
   * @param prepared - the assembled letter.
   * @returns a success outcome carrying the rendered Message-ID.
   */
  send(prepared: PreparedLetter): Promise<SendOutcome> {
    const { letter, rendered } = prepared
    const lines = [
      `[${this.label}] POST letter to=${rendered.recipients.join(', ')}`,
      `--- subject="${letter.subject}" ---`,
      ...previewHeaders(letter),
      '',
      letter.text,
    ]
    for (const attachment of letter.attachments ?? []) {
      const described = describeAttachment(attachment)
      lines.push(`[attachment] ${described.filename} (${described.contentType}, ${attachment.content.byteLength} B)`)
    }
    if (letter.html !== undefined) lines.push('[html] an HTML alternative part was rendered')
    this.#write(`${lines.join('\n')}\n`)
    return Promise.resolve({
      ok: true,
      transport: 'console',
      messageId: rendered.messageId,
      accepted: rendered.recipients,
      from: letter.from,
      at: new Date().toISOString(),
    })
  }
}

/**
 * The production transport: one authenticated submission to the relay.
 *
 * Credentials are resolved per send, so rotating the record in
 * `~/.dsh/.credentials.yaml` takes effect without restarting the host.
 */
export class SmtpTransport implements MailTransport {
  readonly name: Transport = 'smtp'
  readonly label = 'smtp transport'
  readonly #timeoutMs: number
  readonly #requireTls: boolean

  /**
   * @param options - timeout and TLS policy.
   */
  constructor(options: { timeoutMs?: number; requireTls?: boolean } = {}) {
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS
    this.#requireTls = options.requireTls ?? true
  }

  /**
   * Deliver through the relay.
   * @param prepared - the assembled letter.
   * @param context - configuration and credentials.
   * @returns the relay's verdict, mapped onto a structured outcome.
   */
  async send(prepared: PreparedLetter, context: TransportContext): Promise<SendOutcome> {
    const credentials = context.credentials
    if (credentials === undefined) {
      return { ok: false, code: 'credentials', message: 'credentials: no relay credentials were resolved for the smtp transport' }
    }
    try {
      const delivery = await sendViaSmtp({
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password,
        from: prepared.letter.from,
        recipients: prepared.rendered.recipients,
        raw: dotStuff(prepared.rendered.raw),
        timeoutMs: this.#timeoutMs,
        requireTls: this.#requireTls,
        ...(context.dialer === undefined ? {} : { dialer: context.dialer }),
      })
      return {
        ok: true,
        transport: 'smtp',
        messageId: prepared.rendered.messageId,
        accepted: delivery.accepted,
        from: prepared.letter.from,
        at: new Date().toISOString(),
      }
    } catch (error) {
      if (error instanceof SmtpError) return { ok: false, code: 'transport', message: error.message }
      return { ok: false, code: 'transport', message: `transport: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
}

/** Construction knobs for {@link Mailer}. */
export interface MailerOptions {
  /** Transport overrides, keyed by name; defaults to console + smtp. */
  readonly transports?: Partial<Record<Transport, MailTransport>>
  /** Dialer override for the SMTP transport, used by tests. */
  readonly dialer?: SmtpDialer
  /** Pre/post-send guards: rate limiting, send log, audit. */
  readonly guard?: MailGuard | readonly MailGuard[]
  /** Console sink override. */
  readonly write?: (text: string) => void
  /** Timeout for the SMTP conversation. */
  readonly timeoutMs?: number
}

/**
 * The seam implementation: assemble, guard, render, deliver, record.
 *
 * `send` resolves for every outcome — a refusal is data, not an exception —
 * because the callers are agents and CLIs that must branch on a code.
 */
export class Mailer {
  readonly #config: MailConfig
  readonly #transports: Record<Transport, MailTransport>
  readonly #dialer: SmtpDialer | undefined
  readonly #guards: readonly MailGuard[]

  /**
   * @param config - the resolved configuration.
   * @param options - transport, dialer, and guard overrides.
   */
  constructor(config: MailConfig, options: MailerOptions = {}) {
    this.#config = config
    this.#dialer = options.dialer
    this.#guards = options.guard === undefined
      ? []
      : Array.isArray(options.guard)
        ? [...(options.guard as readonly MailGuard[])]
        : [options.guard as MailGuard]
    const consoleTransport = options.transports?.console ?? new ConsoleTransport(options.write)
    const smtpTransport = options.transports?.smtp ?? new SmtpTransport({
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    this.#transports = { console: consoleTransport, smtp: smtpTransport }
  }

  /** The configuration this mailer was built with. */
  get config(): MailConfig {
    return this.#config
  }

  /**
   * Assemble and send one letter.
   *
   * Every exit — a refusal, a missing credential, or a transport verdict —
   * passes through the guards, so the send log and the audit trail record
   * attempts and not just successes.
   * @param request - the caller's request.
   * @returns a success, or the refusal that stopped it.
   */
  async send(request: SendRequest): Promise<SendOutcome> {
    const assembled = assembleLetter(request, this.#config)
    if (!assembled.ok) return this.#notifyRefusal(assembled, { request })
    const letter = assembled.letter
    const transport = this.#transports[this.#config.transport]
    let credentials: SmtpCredentials | undefined
    if (this.#config.transport === 'smtp') {
      const loaded = await loadSmtpCredentials({ path: this.#config.credentialsPath })
      if (loaded.credentials === undefined) {
        return this.#notifyRefusal(
          { ok: false, code: 'credentials', message: `credentials: ${loaded.problem ?? 'no relay credentials found'}` },
          { request, letter },
        )
      }
      credentials = loaded.credentials
    }
    const rendered = renderLetter(letter)
    for (const guard of this.#guards) {
      if (guard.beforeSend === undefined) continue
      const refusal = await guard.beforeSend(letter, rendered, request)
      if (refusal !== undefined) return this.#notifyRefusal(refusal, { request, letter, rendered })
    }
    const outcome = await transport.send({ letter, rendered }, {
      config: this.#config,
      ...(credentials === undefined ? {} : { credentials }),
      ...(this.#dialer === undefined ? {} : { dialer: this.#dialer }),
    })
    for (const guard of this.#guards) {
      if (guard.afterSend !== undefined) await guard.afterSend(letter, outcome)
    }
    return outcome
  }

  /**
   * Hand a refusal to every guard that watches refusals, then return it.
   * @param failure - the refusal.
   * @param context - what was known when the send stopped.
   * @returns the same refusal, so callers can `return this.#notifyRefusal(…)`.
   */
  async #notifyRefusal(failure: SendFailure, context: RefusalContext): Promise<SendFailure> {
    for (const guard of this.#guards) {
      if (guard.onRefusal !== undefined) await guard.onRefusal(failure, context)
    }
    return failure
  }
}

/**
 * Build a mailer from the process environment.
 * @param config - the resolved configuration.
 * @param options - transport and guard overrides.
 * @returns a ready mailer.
 */
export function createMailer(config: MailConfig, options: MailerOptions = {}): Mailer {
  return new Mailer(config, options)
}
