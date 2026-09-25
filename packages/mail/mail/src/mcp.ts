/**
 * `mail-mcp`: the same seam, exposed as MCP tools.
 *
 * The server deliberately offers no inbox. An agent that can read the family's
 * mail is a different security decision from an agent that can send it, and this
 * package only takes the second one. Every call is validated with the same rules
 * the CLI applies, and the seam's guards write the same audit trail.
 * @module @deepseek-ai/dsh-mail/mcp
 */

import type { Mailer } from './seam.ts'
import { createMailer, isAddress, parseRecipients } from './seam.ts'
import { resolveConfig } from './config.ts'
import { buildGuards } from './guards.ts'
import { renderThemedLetter } from './html.ts'
import { formatSendLogSummary, readSendLog, summarizeSendLog } from './sendlog.ts'
import type { MailConfig, SendFailure } from './types.ts'

/** One JSON Schema property. */
interface SchemaProperty {
  readonly type: string
  readonly description: string
  readonly items?: { readonly type: string }
}

/** One tool this server exposes. */
export interface McpToolDefinition {
  /** Tool name, as an agent calls it. */
  readonly name: string
  /** What the tool does. */
  readonly description: string
  /** JSON Schema for the tool input. */
  readonly inputSchema: {
    readonly type: 'object'
    readonly properties: Readonly<Record<string, SchemaProperty>>
    readonly required: readonly string[]
    readonly additionalProperties: boolean
  }
}

const ADDRESS_LIST: SchemaProperty = {
  type: 'array',
  description: 'Recipient addresses; one letter goes to all of them',
  items: { type: 'string' },
}

/** The four tools, with the schemas `tools/list` returns. */
export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'send_email',
    description: 'Send one plain-text or HTML letter through the configured transport',
    inputSchema: {
      type: 'object',
      properties: {
        to: ADDRESS_LIST,
        cc: ADDRESS_LIST,
        subject: { type: 'string', description: 'Subject line, single line, at most 998 characters' },
        text: { type: 'string', description: 'Plain-text body' },
        html: { type: 'string', description: 'Optional HTML body' },
        from: { type: 'string', description: 'Sender; must be on the identity roster' },
        attachments: { type: 'array', description: 'Attachments as {filename, contentBase64}', items: { type: 'object' } },
        batch: { type: 'boolean', description: 'Acknowledge a bulk recipient count' },
      },
      required: ['to', 'subject', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_batch',
    description: 'Send several short letters in one call; each gets its own outcome',
    inputSchema: {
      type: 'object',
      properties: {
        letters: { type: 'array', description: 'Each item: {to, subject, text, cc?}', items: { type: 'object' } },
      },
      required: ['letters'],
      additionalProperties: false,
    },
  },
  {
    name: 'render_template',
    description: 'Render a localized letter template without sending it',
    inputSchema: {
      type: 'object',
      properties: {
        template: { type: 'string', description: 'Template id, e.g. invite, access-recovery, nightly-report, test-letter' },
        locale: { type: 'string', description: 'ru or en' },
        variables: { type: 'object', description: 'Template variables by name' },
      },
      required: ['template'],
      additionalProperties: false,
    },
  },
  {
    name: 'delivery_status',
    description: 'Summarize the send log: counts, last 24 hours, newest timestamp',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'How many recent records to include' },
      },
      required: [],
      additionalProperties: false,
    },
  },
]

/** Tool names, in the order `tools/list` returns them. */
export const MCP_TOOL_NAMES: readonly string[] = MCP_TOOLS.map(tool => tool.name)

/** A JSON-RPC request as it arrives on stdin. */
export interface JsonRpcRequest {
  /** Always `2.0`. */
  readonly jsonrpc: string
  /** Request id; absent for a notification. */
  readonly id?: number | string | null
  /** Method name. */
  readonly method: string
  /** Method parameters. */
  readonly params?: Record<string, unknown>
}

/** Construction knobs for {@link MailMcpServer}. */
export interface MailMcpServerOptions {
  /** The mailer every tool call goes through. */
  readonly mailer: Mailer
  /** Effective configuration, for the status tool. */
  readonly config?: MailConfig
  /** MCP session id, recorded as the audit actor. */
  readonly sessionId?: string
}

/**
 * The MCP server: four tools over one seam.
 *
 * `handle` is transport-agnostic and returns `undefined` for notifications, so
 * the stdio loop, and a test, can drive it frame by frame.
 */
export class MailMcpServer {
  /** MCP session id, when the host provided one; recorded as the audit actor. */
  readonly sessionId: string | undefined
  readonly #mailer: Mailer
  readonly #config: MailConfig

  /**
   * @param options - mailer and session identity.
   */
  constructor(options: MailMcpServerOptions) {
    this.#mailer = options.mailer
    this.#config = options.config ?? options.mailer.config
    this.sessionId = options.sessionId
  }

  /**
   * The tools this server lists.
   * @returns the advertised tool names.
   */
  toolNames(): string[] {
    return [...MCP_TOOL_NAMES]
  }

  /**
   * Handle one JSON-RPC frame.
   * @param frame - the parsed request.
   * @returns the response, or `undefined` when the frame was a notification.
   */
  async handle(frame: JsonRpcRequest): Promise<Record<string, unknown> | undefined> {
    if (frame.method.startsWith('notifications/')) return undefined
    try {
      const result = await this.#dispatch(frame)
      if (frame.id === undefined) return undefined
      return { jsonrpc: '2.0', id: frame.id, ...result }
    } catch (error) {
      if (frame.id === undefined) return undefined
      return {
        jsonrpc: '2.0',
        id: frame.id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      }
    }
  }

  async #dispatch(frame: JsonRpcRequest): Promise<Record<string, unknown>> {
    switch (frame.method) {
      case 'initialize':
        return {
          result: {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'mail-mcp', version: '0.1.5-rc.2' },
          },
        }
      case 'ping':
        return { result: {} }
      case 'tools/list':
        return { result: { tools: MCP_TOOLS } }
      case 'tools/call':
        return { result: await this.#call(frame.params) }
      default:
        return { error: { code: -32601, message: `unknown method "${frame.method}"` } }
    }
  }

  async #call(params: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
    const name = params?.name
    const rawArguments: unknown = params?.arguments ?? {}
    if (typeof name !== 'string') return toolError('missing tool name', 'assembly')
    if (typeof rawArguments !== 'object' || rawArguments === null) return toolError('arguments must be an object', 'assembly')
    const args = rawArguments as Record<string, unknown>
    switch (name) {
      case 'send_email': return this.#sendEmail(args)
      case 'send_batch': return this.#sendBatch(args)
      case 'render_template': return this.#renderTemplate(args)
      case 'delivery_status': return this.#deliveryStatus(args)
      default: return toolError(`unknown tool "${name}"`, 'assembly')
    }
  }

  async #sendEmail(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const recipients = asAddresses(args.to)
    if (recipients.length === 0) return toolError('send_email: "to" must contain at least one address', 'recipients')
    for (const address of [...recipients, ...asAddresses(args.cc)]) {
      if (!isAddress(address)) return toolError(`send_email: "${address}" is not a usable address`, 'recipients')
    }
    const subject = args.subject
    const text = args.text
    if (typeof subject !== 'string' || subject.length === 0) return toolError('send_email: "subject" is required', 'assembly')
    if (subject.length > 998) return toolError('send_email: "subject" exceeds 998 characters', 'assembly')
    if (typeof text !== 'string' || text.length === 0) return toolError('send_email: "text" is required', 'assembly')
    if (text.length > 200_000) return toolError('send_email: "text" exceeds 200000 characters', 'assembly')
    const attachments = asAttachments(args.attachments)
    if (typeof attachments === 'string') return toolError(attachments, 'attachment_type_blocked')
    const outcome = await this.#mailer.send({
      to: recipients,
      subject,
      text,
      ...(asAddresses(args.cc).length === 0 ? {} : { cc: asAddresses(args.cc) }),
      ...(typeof args.html === 'string' ? { html: args.html } : {}),
      ...(typeof args.from === 'string' ? { from: args.from } : {}),
      ...(attachments.length === 0 ? {} : { attachments }),
      ...(args.batch ? { batch: true } : {}),
    })
    return outcome.ok ? textResult(outcome) : refusalResult(outcome)
  }

  async #sendBatch(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const letters = args.letters
    if (!Array.isArray(letters) || letters.length === 0) return toolError('send_batch: "letters" must be a non-empty array', 'assembly')
    if (letters.length > 50) return toolError('send_batch: at most 50 letters per call', 'assembly')
    const results: Record<string, unknown>[] = []
    for (const entry of letters) {
      if (typeof entry !== 'object' || entry === null) {
        results.push({ ok: false, error: { code: 'assembly', message: 'every letter must be an object' } })
        continue
      }
      results.push(await this.#sendEmail(entry as Record<string, unknown>))
    }
    const failed = results.filter(entry => entry.isError).length
    return { content: [{ type: 'text', text: JSON.stringify({ ok: failed === 0, total: results.length, failed, results }) }], ...(failed === 0 ? {} : { isError: true }) }
  }

  #renderTemplate(args: Record<string, unknown>): Record<string, unknown> {
    const id = args.template
    const locale = args.locale ?? 'ru'
    if (typeof id !== 'string') return toolError('render_template: "template" is required', 'assembly')
    if (locale !== 'ru' && locale !== 'en') return toolError('render_template: "locale" must be ru or en', 'assembly')
    const variables: Record<string, string> = {}
    if (typeof args.variables === 'object' && args.variables !== null) {
      for (const [name, value] of Object.entries(args.variables as Record<string, unknown>)) {
        variables[name] = typeof value === 'string' ? value : JSON.stringify(value)
      }
    }
    const themed = renderThemedLetter(id, locale, variables, { includeStyleBlock: false })
    return themed.ok
      ? textResult({ ok: true, subject: themed.subject, text: themed.text, html: themed.html })
      : refusalResult(themed)
  }

  async #deliveryStatus(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const summary = await summarizeSendLog(this.#config.logPath)
    const limit = typeof args.limit === 'number' ? Math.max(0, Math.min(200, Math.trunc(args.limit))) : 20
    return textResult({
      ok: true,
      summary,
      line: formatSendLogSummary(summary),
      recent: await readSendLog(this.#config.logPath, { limit }),
    })
  }
}

/**
 * Run the stdio loop: one JSON-RPC frame per line.
 * @param server - the server.
 * @param io - input lines and an output sink.
 */
export async function runStdioServer(
  server: MailMcpServer,
  io: { readonly input: AsyncIterable<string>; readonly output: (line: string) => void } = {
    input: process.stdin,
    output: (line) => { process.stdout.write(`${line}\n`) },
  },
): Promise<void> {
  let buffer = ''
  for await (const chunk of io.input) {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (line.length === 0) continue
      let frame: JsonRpcRequest
      try {
        frame = JSON.parse(line) as JsonRpcRequest
      } catch {
        io.output(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }))
        continue
      }
      const response = await server.handle(frame)
      if (response !== undefined) io.output(JSON.stringify(response))
    }
  }
}

/**
 * Build a server from the environment.
 * @returns a server wired to the environment configuration and the shared guard stack.
 */
export function createServerFromEnv(): MailMcpServer {
  const config = resolveConfig()
  const sessionId = process.env.MSH_SESSION_ID
  const mailer = createMailer(config, { guard: buildGuards(config, { ...(sessionId === undefined ? {} : { actor: `mcp:${sessionId}` }) }) })
  return new MailMcpServer({
    mailer,
    config,
    ...(sessionId === undefined ? {} : { sessionId }),
  })
}

/** Wrap a value as an MCP text result. */
function textResult(value: unknown): Record<string, unknown> {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Wrap a refusal as an MCP error result. */
function refusalResult(failure: SendFailure): Record<string, unknown> {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: false,
        error: {
          code: failure.code,
          message: failure.message,
          ...(failure.scope === undefined ? {} : { scope: failure.scope }),
        },
      }),
    }],
    isError: true,
  }
}

/** Wrap a validation message as an MCP error result. */
function toolError(message: string, code: SendFailure['code']): Record<string, unknown> {
  return refusalResult({ ok: false, code, message })
}

/**
 * Coerce a tool argument into a list of addresses.
 * @param value - the raw argument.
 * @returns the addresses.
 */
function asAddresses(value: unknown): string[] {
  if (typeof value === 'string') return parseRecipients(value)
  if (Array.isArray(value)) return value.flatMap(entry => (typeof entry === 'string' ? parseRecipients(entry) : []))
  return []
}

/**
 * Decode base64 attachments from a tool call.
 * @param value - the raw argument.
 * @returns the attachments, or an error message.
 */
function asAttachments(value: unknown): import('./types.ts').Attachment[] | string {
  if (value === undefined) return []
  if (!Array.isArray(value)) return 'attachments must be an array'
  const attachments: import('./types.ts').Attachment[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return 'every attachment must be an object'
    const record = entry as Record<string, unknown>
    if (typeof record.filename !== 'string' || typeof record.contentBase64 !== 'string') {
      return 'every attachment needs filename and contentBase64'
    }
    attachments.push({ filename: record.filename, content: new Uint8Array(Buffer.from(record.contentBase64, 'base64')) })
  }
  return attachments
}
