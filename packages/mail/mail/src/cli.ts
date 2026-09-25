/**
 * `mail-send` and friends: the command surface agents call.
 *
 * Exit codes are part of the contract, not an implementation detail: `0` for a
 * delivered or dry-run letter, `2` for a refusal the caller should read and
 * act on, `3` for a malformed invocation. A caller that only checks `$?` still
 * learns whether mail left the host.
 * @module @deepseek-ai/dsh-mail/cli
 */

import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveConfig } from './config.ts'
import { assembleLetter, createMailer, type Mailer, type SendRequest } from './seam.ts'
import { buildGuards } from './guards.ts'
import { renderLetter } from './mime.ts'
import { generateMailI18nReport, renderTemplate, type MailLocale } from './templates.ts'
import { formatSendLogSummary, readDmarcReports, formatDmarcDigest, summarizeSendLog, rotateSendLog } from './sendlog.ts'
import { renderThemedLetter } from './html.ts'
import { runAcceptance, formatAcceptanceTable } from './accept.ts'
import type { Attachment, MailConfig, SendFailure, SendOutcome } from './types.ts'

/** A delivered letter, a successful dry run, or nothing was sent. */
export const EXIT_OK = 0
/** The host refused to send; the JSON body carries the reason. */
export const EXIT_REFUSED = 2
/** The invocation itself was wrong. */
export const EXIT_USAGE = 3

/** Where the CLI writes. */
export interface CliIo {
  /** Standard output, one write per chunk. */
  readonly out: (text: string) => void
  /** Standard error. */
  readonly err: (text: string) => void
}

/** The default IO, backed by the process streams. */
export const processIo: CliIo = {
  out: (text) => { process.stdout.write(text) },
  err: (text) => { process.stderr.write(text) },
}

/** Parsed command line. */
export interface CliInvocation {
  /** Subcommand: `send`, `preview`, `status`, `accept`, `i18n`, or `help`. */
  readonly command: string
  /** Positional arguments. */
  readonly rest: readonly string[]
  /** Flags, with repeatable flags collected into lists. */
  readonly flags: ReadonlyMap<string, readonly string[]>
}

const REPEATABLE = new Set(['to', 'cc', 'attach', 'var'])

/**
 * Parse the command line.
 * @param argv - arguments after the binary name.
 * @returns the invocation, or a usage message.
 */
export function parseArgv(argv: readonly string[]): CliInvocation | { error: string } {
  const flags = new Map<string, string[]>()
  const rest: string[] = []
  let command = 'send'
  let index = 0
  const first = argv[0]
  if (first !== undefined && !first.startsWith('-')) {
    command = first
    index = 1
  }
  for (; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) break
    if (!token.startsWith('--')) {
      rest.push(token)
      continue
    }
    const equals = token.indexOf('=')
    const name = (equals < 0 ? token.slice(2) : token.slice(2, equals)).toLowerCase()
    let value: string | undefined = equals < 0 ? undefined : token.slice(equals + 1)
    const next = argv[index + 1]
    if (value === undefined && next !== undefined && !next.startsWith('--')) {
      value = next
      index += 1
    }
    const existing = flags.get(name) ?? []
    if (!REPEATABLE.has(name) && existing.length > 0) {
      return { error: `--${name} was given more than once` }
    }
    flags.set(name, [...existing, value ?? 'true'])
  }
  return { command, rest, flags }
}

/**
 * The `--help` text, including the exit-code contract.
 * @returns the help text.
 */
export function helpText(): string {
  return [
    'mail-send — send a letter through the configured transport',
    '',
    'Usage:',
    '  mail-send --to <addr> --subject <line> --body <text> [options]',
    '  mail-send --to <addr> --subject <line> --template <id> --locale <ru|en> --var k=v [options]',
    '  mail-send preview --template <id> --locale <ru|en> [--out <file>] [--style]',
    '  mail-send status [--json] [--dmarc <dir>] [--rotate]',
    '  mail-send accept [--suite core] [--dry-run] [--live --to <addr>]',
    '  mail-send i18n [--json]',
    '',
    'Options:',
    '  --to <addr>            recipient; repeatable or comma-separated',
    '  --cc <addr>            carbon copy; repeatable',
    '  --subject <line>       subject',
    '  --body <text>          inline body',
    '  --body-file <path>     read the body from a file',
    '  --stdin                read the body from standard input',
    '  --html-file <path>     attach an HTML alternative from a file',
    '  --attach <path>        attach a file; repeatable',
    '  --from <addr>          sender; must be on the identity roster',
    '  --template <id>        render a localized template',
    '  --locale <ru|en>       template locale (default ru)',
    '  --var <name>=<value>   template variable; repeatable',
    '  --batch                acknowledge a bulk recipient count',
    '  --dry-run              assemble and print, contact no transport',
    '  --json                 machine-readable output',
    '  --completion <shell>   print a bash or zsh completion script',
    '',
    'Exit codes:',
    '  0  sent, or a dry run that assembled cleanly',
    '  2  refused; stderr/JSON carries code, scope and message',
    '  3  usage error',
    '',
  ].join('\n')
}

/**
 * A completion script for the given shell.
 * @param shell - `bash` or `zsh`.
 * @returns the script text, or `undefined` for an unknown shell.
 */
export function completionScript(shell: string): string | undefined {
  const commands = 'send preview status accept i18n help'
  const flags = '--to --cc --subject --body --body-file --stdin --html-file --attach --from --template --locale --var --batch --dry-run --json --out --style --rotate --live --suite --dmarc --completion --help'
  if (shell === 'bash') {
    return [
      '_mail_send() {',
      `  local commands="${commands}"`,
      `  local flags="${flags}"`,
      '  local current="${COMP_WORDS[COMP_CWORD]}"',
      '  COMPREPLY=( $(compgen -W "$commands $flags" -- "$current") )',
      '}',
      'complete -F _mail_send mail-send',
      '',
    ].join('\n')
  }
  if (shell === 'zsh') {
    return [
      '#compdef mail-send',
      `_mail_send() { _arguments '*: :(${commands} ${flags})' }`,
      'compdef _mail_send mail-send',
      '',
    ].join('\n')
  }
  return undefined
}

/** Flags a parsed invocation carries, with defaults applied. */
interface SendFlags {
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly attachments: readonly string[]
  readonly subject: string
  readonly body?: string
  readonly bodyFile?: string
  readonly htmlFile?: string
  readonly from?: string
  readonly template?: string
  readonly locale: MailLocale
  readonly variables: Readonly<Record<string, string>>
  readonly batch: boolean
  readonly dryRun: boolean
  readonly json: boolean
  readonly stdin: boolean
}

/**
 * Convert raw flags into the values the send path needs.
 * @param flags - the parsed flag map.
 * @returns the send flags, or a usage message.
 */
function sendFlags(flags: CliInvocation['flags']): SendFlags | { error: string } {
  const one = (name: string): string | undefined => flags.get(name)?.[0]
  const many = (name: string): string[] => (flags.get(name) ?? []).flatMap(value => value.split(',')).map(value => value.trim()).filter(value => value.length > 0)
  const locale = one('locale') ?? 'ru'
  if (locale !== 'ru' && locale !== 'en') return { error: `--locale must be ru or en, got "${locale}"` }
  const variables: Record<string, string> = {}
  for (const entry of flags.get('var') ?? []) {
    const equals = entry.indexOf('=')
    if (equals <= 0) return { error: `--var expects name=value, got "${entry}"` }
    variables[entry.slice(0, equals)] = entry.slice(equals + 1)
  }
  const body = one('body')
  const bodyFile = one('body-file')
  const htmlFile = one('html-file')
  const from = one('from')
  const template = one('template')
  return {
    to: many('to'),
    cc: many('cc'),
    attachments: flags.get('attach') ?? [],
    subject: one('subject') ?? '',
    ...(body === undefined ? {} : { body }),
    ...(bodyFile === undefined ? {} : { bodyFile }),
    ...(htmlFile === undefined ? {} : { htmlFile }),
    ...(from === undefined ? {} : { from }),
    ...(template === undefined ? {} : { template }),
    locale,
    variables,
    batch: flags.has('batch'),
    dryRun: flags.has('dry-run'),
    json: flags.has('json'),
    stdin: flags.has('stdin'),
  }
}

/**
 * Render a refusal in the shape every caller branches on.
 * @param failure - the refusal.
 * @returns the JSON text.
 */
export function failureJson(failure: SendFailure): string {
  return `${JSON.stringify({
    ok: false,
    error: {
      code: failure.code,
      message: failure.message,
      ...(failure.scope === undefined ? {} : { scope: failure.scope }),
      ...(failure.detail === undefined ? {} : { detail: failure.detail }),
      ...(failure.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: failure.retryAfterSeconds }),
    },
  })}\n`
}

/** Read a file into an attachment. */
async function readAttachment(path: string): Promise<Attachment> {
  const content = await readFile(path)
  return { filename: basename(path), content: new Uint8Array(content) }
}

/** Read standard input to a string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Build the send request from flags, reading files and stdin as needed.
 * @param parsed - the send flags.
 * @param stdin - reader used when `--stdin` is given.
 * @returns the request, or a usage message.
 */
async function buildRequest(parsed: SendFlags, stdin: () => Promise<string> = readStdin): Promise<SendRequest | { error: string }> {
  if (parsed.to.length === 0) return { error: 'at least one --to address is required' }
  let subject = parsed.subject
  let text = parsed.body ?? ''
  if (parsed.template !== undefined) {
    const rendered = renderTemplate(parsed.template, parsed.locale, parsed.variables)
    if (!rendered.ok) return { error: rendered.message }
    subject = subject.length > 0 ? subject : rendered.subject
    text = rendered.text
  } else if (parsed.bodyFile !== undefined) {
    text = await readFile(parsed.bodyFile, 'utf8')
  } else if (parsed.stdin) {
    text = await stdin()
  }
  if (subject.length === 0) return { error: '--subject is required (or use --template)' }
  if (text.length === 0) return { error: 'a body is required: --body, --body-file, --stdin, or --template' }
  const html = parsed.htmlFile === undefined ? undefined : await readFile(parsed.htmlFile, 'utf8')
  const attachments = await Promise.all(parsed.attachments.map(readAttachment))
  return {
    to: parsed.to,
    subject,
    text,
    ...(parsed.cc.length === 0 ? {} : { cc: parsed.cc }),
    ...(html === undefined ? {} : { html }),
    ...(parsed.from === undefined ? {} : { from: parsed.from }),
    ...(attachments.length === 0 ? {} : { attachments }),
    batch: parsed.batch,
  }
}

/** Construction knobs for {@link runCli}. */
export interface CliDependencies {
  /** Configuration override, for tests. */
  readonly config?: MailConfig
  /** Mailer override, for tests. */
  readonly mailer?: Mailer
  /** Standard input override, for tests. */
  readonly readStdin?: () => Promise<string>
}

/**
 * Run one CLI invocation.
 *
 * Never throws for a refused send: a refusal is data, printed as JSON or prose,
 * and the returned exit code is the only signal a script needs.
 * @param argv - arguments after the binary name.
 * @param io - output sinks.
 * @param dependencies - overrides used by tests.
 * @returns the process exit code.
 */
export async function runCli(
  argv: readonly string[],
  io: CliIo = processIo,
  dependencies: CliDependencies = {},
): Promise<number> {
  const parsed = parseArgv(argv)
  if ('error' in parsed) {
    io.err(`mail-send: ${parsed.error}\n`)
    return EXIT_USAGE
  }
  const config = dependencies.config ?? resolveConfig()
  const wantsJson = parsed.flags.has('json')

  if (parsed.command === 'help' || parsed.flags.has('help')) {
    io.out(helpText())
    return EXIT_OK
  }
  if (parsed.flags.has('completion')) {
    const script = completionScript(parsed.flags.get('completion')?.[0] ?? '')
    if (script === undefined) {
      io.err('mail-send: --completion expects bash or zsh\n')
      return EXIT_USAGE
    }
    io.out(script)
    return EXIT_OK
  }
  if (parsed.command === 'i18n') {
    const report = generateMailI18nReport()
    io.out(wantsJson ? `${JSON.stringify({ ok: report.includes('\nFAIL'), report })}\n` : `${report}\n`)
    return report.includes('\nFAIL') ? EXIT_REFUSED : EXIT_OK
  }
  if (parsed.command === 'preview') {
    const id = parsed.flags.get('template')?.[0]
    if (id === undefined) {
      io.err('mail-send preview: --template is required\n')
      return EXIT_USAGE
    }
    const locale = (parsed.flags.get('locale')?.[0] ?? 'ru') as MailLocale
    const variables: Record<string, string> = {}
    for (const entry of parsed.flags.get('var') ?? []) {
      const equals = entry.indexOf('=')
      if (equals <= 0) {
        io.err(`mail-send preview: --var expects name=value, got "${entry}"\n`)
        return EXIT_USAGE
      }
      variables[entry.slice(0, equals)] = entry.slice(equals + 1)
    }
    const themed = renderThemedLetter(id, locale, variables, { includeStyleBlock: parsed.flags.has('style') })
    if (!themed.ok) {
      io.err(wantsJson ? failureJson(themed) : `${themed.message}\n`)
      return EXIT_REFUSED
    }
    const out = parsed.flags.get('out')?.[0]
    if (out === undefined) {
      io.out(themed.html)
      return EXIT_OK
    }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(out, themed.html, { mode: 0o600 })
    io.out(`${out}\n`)
    return EXIT_OK
  }
  if (parsed.command === 'status') {
    if (parsed.flags.has('rotate')) {
      const rotated = await rotateSendLog(config.logPath)
      io.out(rotated.rotated ? `rotated → ${rotated.archive}\n` : 'nothing to rotate\n')
    }
    const summary = await summarizeSendLog(config.logPath)
    const dmarcDir = parsed.flags.get('dmarc')?.[0]
    if (dmarcDir !== undefined) {
      const digest = formatDmarcDigest(await readDmarcReports(dmarcDir))
      io.out(wantsJson ? `${JSON.stringify({ ok: true, summary, dmarc: digest })}\n` : `${formatSendLogSummary(summary)}\n${digest}\n`)
      return EXIT_OK
    }
    io.out(wantsJson ? `${JSON.stringify({ ok: true, summary, today: summary.today })}\n` : `${formatSendLogSummary(summary)}\n`)
    return EXIT_OK
  }
  if (parsed.command === 'accept') {
    const result = await runAcceptance({
      config,
      dryRun: parsed.flags.has('dry-run'),
      ...(parsed.flags.get('to')?.[0] === undefined ? {} : { liveTo: parsed.flags.get('to')?.[0] as string }),
      ...(dependencies.mailer === undefined ? {} : { mailer: dependencies.mailer }),
    })
    io.out(wantsJson ? `${JSON.stringify(result)}\n` : `${formatAcceptanceTable(result)}\n`)
    return result.ok ? EXIT_OK : EXIT_REFUSED
  }
  if (parsed.command !== 'send') {
    io.err(`mail-send: unknown command "${parsed.command}"\n`)
    return EXIT_USAGE
  }

  const flags = sendFlags(parsed.flags)
  if ('error' in flags) {
    io.err(`mail-send: ${flags.error}\n`)
    return EXIT_USAGE
  }
  const request = await buildRequest(flags, dependencies.readStdin ?? readStdin)
  if ('error' in request) {
    io.err(`mail-send: ${request.error}\n`)
    return EXIT_USAGE
  }

  if (flags.dryRun) {
    const assembled = assembleLetter(request, config)
    if (!assembled.ok) {
      io.err(wantsJson ? failureJson(assembled) : `${assembled.message}\n`)
      return EXIT_REFUSED
    }
    const rendered = renderLetter(assembled.letter)
    io.out(wantsJson
      ? `${JSON.stringify({ ok: true, dryRun: true, transport: config.transport, messageId: rendered.messageId, recipients: rendered.recipients, from: assembled.letter.from, bytes: rendered.raw.length })}\n`
      : `dry run: ${config.transport} would carry ${rendered.recipients.length} recipient(s), ${rendered.raw.length} bytes, message-id ${rendered.messageId}\n`)
    return EXIT_OK
  }

  const mailer = dependencies.mailer ?? createMailer(config, { guard: buildGuards(config) })
  const outcome: SendOutcome = await mailer.send(request)
  if (!outcome.ok) {
    io.err(wantsJson ? failureJson(outcome) : `${outcome.message}\n`)
    return EXIT_REFUSED
  }
  io.out(wantsJson
    ? `${JSON.stringify({ ok: true, transport: outcome.transport, messageId: outcome.messageId, accepted: outcome.accepted, from: outcome.from, at: outcome.at })}\n`
    : `sent via ${outcome.transport} to ${outcome.accepted.join(', ')} (${outcome.messageId})\n`)
  return EXIT_OK
}

/**
 * Entry point for the binaries: run and exit.
 * @param argv - arguments after the binary name; defaults to the process's.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const code = await runCli(argv)
  process.exitCode = code
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main()
}
