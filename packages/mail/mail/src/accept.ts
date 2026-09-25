/**
 * `mail-accept`: one command that proves the mail path end to end.
 *
 * The suite is deterministic and offline: everything runs against the console
 * transport and a local one-shot SMTP peer, so it can be run by an operator or
 * an agent at any time. `--live --to <address>` adds the one check that cannot
 * be faked, a real letter delivered by the configured relay; header
 * authentication (SPF/DKIM/DMARC) is confirmed on the receiving side by
 * `runs/*​/artifacts/ms-001-probe.py`, not here.
 * @module @deepseek-ai/dsh-mail/accept
 */

import { mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { MailGuard, Mailer } from './seam.ts'
import { assembleLetter, createMailer } from './seam.ts'
import { buildGuards } from './guards.ts'
import { defaultAttachmentLimits } from './attachments.ts'
import { renderLetter } from './mime.ts'
import { renderThemedLetter } from './html.ts'
import { renderTemplate, verifyTemplateParity } from './templates.ts'
import { MCP_TOOL_NAMES } from './mcp.ts'
import { sendViaSmtp } from './smtp.ts'
import { RateLimiter } from './limits.ts'
import { SendLog, readSendLog } from './sendlog.ts'
import { AuditLog, verifyAuditChain } from './identity.ts'
import type { Attachment, MailConfig, SendFailure, Transport } from './types.ts'

/** One probe in the suite. */
export interface AcceptanceCheck {
  /** Stable check name, usable as a grep target. */
  readonly name: string
  /** Whether the probe passed. */
  readonly ok: boolean
  /** Human-readable evidence or the failure reason. */
  readonly detail: string
}

/** The outcome of the optional live letter. */
export interface AcceptanceLiveResult {
  /** Address the live letter was sent to. */
  readonly to: string
  /** Whether the relay accepted it. */
  readonly ok: boolean
  /** Message id when accepted. */
  readonly messageId?: string
  /** Refusal code when not accepted. */
  readonly code?: string
  /** Human-readable evidence. */
  readonly detail: string
}

/** The suite's result, which the CLI prints and exits on. */
export interface AcceptanceResult {
  /** True when every probe passed. */
  readonly ok: boolean
  /** Whether this was a dry run. */
  readonly dryRun: boolean
  /** Transport the deterministic probes ran on. */
  readonly transport: Transport
  /** Where the probes wrote their log. */
  readonly logPath: string
  /** Per-probe results. */
  readonly checks: readonly AcceptanceCheck[]
  /** The live check, when one was requested. */
  readonly live?: AcceptanceLiveResult
}

/** Options for {@link runAcceptance}. */
export interface AcceptanceOptions {
  /** Effective configuration. */
  readonly config: MailConfig
  /** Only run the offline probes and report what would be checked live. */
  readonly dryRun?: boolean
  /** Address for the one real letter; omit to stay offline. */
  readonly liveTo?: string
  /** Mailer override for the live letter, for tests. */
  readonly mailer?: Mailer
  /** Clock override for the rate-limit probe. */
  readonly now?: () => Date
}

/**
 * Run the acceptance suite.
 * @param options - configuration and optional live target.
 * @returns per-probe results and an overall verdict.
 */
export async function runAcceptance(options: AcceptanceOptions): Promise<AcceptanceResult> {
  const { config } = options
  const root = join(config.dataDir, 'acceptance')
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true, mode: 0o700 })
  const derived: MailConfig = {
    ...config,
    transport: 'console',
    logPath: join(root, 'send.log.jsonl'),
    statePath: join(root, 'rate.json'),
    dataDir: root,
    policy: { allow: [], deny: ['*@blocked.example'] },
    attachmentLimits: { ...defaultAttachmentLimits, maxBytesPerFile: 4096, maxTotalBytes: 8192 },
  }
  const mailer = createMailer(derived, { guard: buildGuards(derived), write: () => {} })
  const checks: AcceptanceCheck[] = []

  const probe = async (name: string, run: () => Promise<string> | string): Promise<void> => {
    try {
      checks.push({ name, ok: true, detail: await run() })
    } catch (error) {
      checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
    }
  }

  await probe('templates-ru-en-parity', () => {
    const problems = verifyTemplateParity()
    if (problems.length > 0) throw new Error(`${problems.length} parity problem(s): ${problems.map(p => `${p.template}/${p.kind}`).join(', ')}`)
    return 'every template has ru+en with identical variables'
  })

  await probe('template-render-ru', () => {
    const rendered = renderTemplate('invite', 'ru', { name: 'Тимур', expiresMinutes: '10', link: 'https://example.test/i' })
    if (!rendered.ok) throw new Error(rendered.message)
    if (!rendered.subject.includes('Тимур')) throw new Error('subject lost the variable')
    return `subject="${rendered.subject}"`
  })

  await probe('html-inline-only', () => {
    const themed = renderThemedLetter('test-letter', 'ru', { stamp: '2026-09-25', transport: 'console' })
    if (!themed.ok) throw new Error(themed.message)
    if (themed.html.includes('<style')) throw new Error('sent HTML contains a <style> block')
    if (!themed.html.includes('style="')) throw new Error('HTML has no inline styles')
    return `${themed.html.length} bytes, 0 <style> blocks`
  })

  await probe('multipart-alternative', () => {
    const assembled = assembleLetter({ to: ['timur@example.test'], subject: 'both parts', text: 'plain', html: '<p>rich</p>' }, derived)
    if (!assembled.ok) throw new Error(assembled.message)
    const rendered = renderLetter(assembled.letter)
    if (!rendered.raw.includes('multipart/alternative')) throw new Error('no multipart/alternative part')
    if (!rendered.raw.includes('text/plain')) throw new Error('no plain-text alternative')
    return `messageId=${rendered.messageId}`
  })

  await probe('console-send', async () => {
    const outcome = await mailer.send({ to: ['timur@example.test'], subject: 'acceptance', text: 'hello' })
    if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}`)
    return `accepted by ${outcome.transport}, ${outcome.messageId}`
  })

  await probe('identity-spoof-blocked', async () => {
    const outcome = await mailer.send({ to: ['timur@example.test'], from: 'intruder@example.test', subject: 'spoof', text: 'x' })
    if (outcome.ok) throw new Error('a foreign From was accepted')
    expectCode(outcome, 'identity_not_allowed')
    return `refused with ${outcome.code}`
  })

  await probe('policy-blocked', async () => {
    const outcome = await mailer.send({ to: ['someone@blocked.example'], subject: 'denied', text: 'x' })
    if (outcome.ok) throw new Error('a denied recipient was accepted')
    expectCode(outcome, 'policy_blocked')
    return `refused with ${outcome.code} (scope ${outcome.scope ?? '—'})`
  })

  await probe('rate-limit-trips', async () => {
    const limited: MailConfig = { ...derived, statePath: join(root, 'rate-limited.json') }
    const guard = new RateLimiter({
      statePath: limited.statePath,
      limits: {
        perMinute: 1,
        perHour: 10,
        perDay: 10,
        perRecipientPerDay: 10,
        newRecipientPerHour: 10,
        bulkRecipients: 5,
      },
    })
    const guarded = createMailer(limited, { guard, write: () => {} })
    const first = await guarded.send({ to: ['timur@example.test'], subject: 'one', text: 'x' })
    if (!first.ok) throw new Error(`first send refused: ${first.code}`)
    const second = await guarded.send({ to: ['timur@example.test'], subject: 'two', text: 'x' })
    if (second.ok) throw new Error('the per-minute cap did not trip')
    expectCode(second, 'rate_limited')
    return `second send refused with ${second.code} (retry in ${second.retryAfterSeconds ?? '?'}s)`
  })

  await probe('attachment-guards', async () => {
    const tooBig: Attachment = { filename: 'big.bin', content: new Uint8Array(5000) }
    const oversized = await mailer.send({ to: ['timur@example.test'], subject: 'big', text: 'x', attachments: [tooBig] })
    if (oversized.ok) throw new Error('an oversized attachment was accepted')
    expectCode(oversized, 'attachment_too_large')
    const executable: Attachment = { filename: 'report.pdf.exe', content: new Uint8Array([1, 2, 3]) }
    const blocked = await mailer.send({ to: ['timur@example.test'], subject: 'exe', text: 'x', attachments: [executable] })
    if (blocked.ok) throw new Error('a double-extension executable was accepted')
    expectCode(blocked, 'attachment_type_blocked')
    return `${oversized.code} then ${blocked.code}`
  })

  await probe('send-log-rows', async () => {
    const records = await readSendLog(derived.logPath)
    const statuses = new Set(records.map(record => record.status))
    for (const wanted of ['sent', 'refused'] as const) {
      if (!statuses.has(wanted)) throw new Error(`no "${wanted}" row in the send log`)
    }
    if (!records.every(record => record.recipients.every(address => address.startsWith('sha256:')))) {
      throw new Error('a recipient address was stored in clear text')
    }
    return `${records.length} rows, statuses ${[...statuses].join('+')}, recipients hashed`
  })

  await probe('audit-chain-ok', async () => {
    const verdict = await verifyAuditChain(join(root, 'audit.log'))
    if (!verdict.ok) throw new Error(`audit chain broken at entry ${verdict.brokenAt ?? '?'}`)
    if (verdict.entries < 3) throw new Error(`only ${verdict.entries} audit entries`)
    return `${verdict.entries} chained entries, hash chain verified`
  })

  await probe('mcp-tool-surface', () => {
    if (MCP_TOOL_NAMES.length !== 4) throw new Error(`expected 4 tools, found ${MCP_TOOL_NAMES.length}`)
    for (const wanted of ['send_email', 'send_batch', 'render_template', 'delivery_status']) {
      if (!MCP_TOOL_NAMES.includes(wanted)) throw new Error(`missing tool ${wanted}`)
    }
    return MCP_TOOL_NAMES.join(', ')
  })

  await probe('smtp-conversation', () => smtpConversation(derived))

  await probe('dry-run-writes-nothing', async () => {
    const before = (await readSendLog(derived.logPath)).length
    const assembled = assembleLetter({ to: ['timur@example.test'], subject: 'dry', text: 'x' }, derived)
    if (!assembled.ok) throw new Error(assembled.message)
    renderLetter(assembled.letter)
    const after = (await readSendLog(derived.logPath)).length
    if (after !== before) throw new Error('assembling a dry run wrote to the log')
    return `log length unchanged at ${before}`
  })

  if (options.dryRun) {
    return { ok: checks.every(check => check.ok), dryRun: true, transport: derived.transport, logPath: derived.logPath, checks }
  }

  if (options.liveTo === undefined) {
    return { ok: checks.every(check => check.ok), dryRun: false, transport: config.transport, logPath: derived.logPath, checks }
  }

  const liveMailer = options.mailer ?? createMailer(config, {
    guard: [new SendLog({ logPath: config.logPath, saltPath: join(config.dataDir, 'recipient-salt'), actor: 'acceptance' }), new AuditLog({ path: join(config.dataDir, 'audit.log'), actor: 'acceptance' })],
  })
  const live = await liveMailer.send({ to: [options.liveTo], subject: 'mail-accept live probe', text: `live acceptance probe at ${new Date().toISOString()}` })
  const liveResult: AcceptanceLiveResult = live.ok
    ? { to: options.liveTo, ok: true, messageId: live.messageId, detail: `accepted by ${live.transport} via ${config.transport}` }
    : { to: options.liveTo, ok: false, code: live.code, detail: `${live.code}: ${live.message}` }
  return {
    ok: checks.every(check => check.ok) && liveResult.ok,
    dryRun: false,
    transport: config.transport,
    logPath: derived.logPath,
    checks,
    live: liveResult,
  }
}

/**
 * Render the suite as a fixed-width table.
 * @param result - the suite result.
 * @returns text ending with a RESULT line.
 */
export function formatAcceptanceTable(result: AcceptanceResult): string {
  const lines = [`mail-accept (${result.transport}${result.dryRun ? ', dry run' : ''}${result.live === undefined ? '' : `, live → ${result.live.to}`})`]
  for (const check of result.checks) {
    lines.push(`${check.ok ? 'PASS' : 'FAIL'}  ${check.name.padEnd(26)} ${check.detail}`)
  }
  if (result.live !== undefined) {
    lines.push(`${result.live.ok ? 'PASS' : 'FAIL'}  ${'live-delivery'.padEnd(26)} ${result.live.detail}`)
  }
  const passed = result.checks.filter(check => check.ok).length + (result.live?.ok ? 1 : 0)
  const total = result.checks.length + (result.live === undefined ? 0 : 1)
  lines.push(`RESULT: ${result.ok ? 'PASS' : 'FAIL'} (${passed}/${total})`)
  return lines.join('\n')
}

/**
 * Play one submission against a local SMTP peer and check what crossed the wire.
 * @param config - configuration supplying the envelope sender.
 * @returns evidence text.
 */
async function smtpConversation(config: MailConfig): Promise<string> {
  const transcript: string[] = []
  let authStep = 0
  let inData = false
  let dataBytes = 0
  const server = createServer((socket) => {
    socket.write('220 accept.local ESMTP\r\n')
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let index = buffer.indexOf('\r\n')
      while (index >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        index = buffer.indexOf('\r\n')
        transcript.push(line)
        if (inData) {
          if (line === '.') {
            inData = false
            socket.write('250 2.0.0 queued as ACCEPT1\r\n')
          } else {
            dataBytes += line.length
          }
          continue
        }
        const command = line.toUpperCase()
        if (command.startsWith('EHLO') || command.startsWith('HELO')) socket.write('250-accept.local\r\n250 AUTH LOGIN PLAIN\r\n')
        else if (command.startsWith('AUTH LOGIN')) { authStep = 1; socket.write('334 VXNlcm5hbWU6\r\n') }
        else if (authStep === 1) { authStep = 2; socket.write('334 UGFzc3dvcmQ6\r\n') }
        else if (authStep === 2) { authStep = 3; socket.write('235 2.7.0 authenticated\r\n') }
        else if (command.startsWith('MAIL FROM')) socket.write('250 2.1.0 sender ok\r\n')
        else if (command.startsWith('RCPT TO')) socket.write('250 2.1.5 recipient ok\r\n')
        else if (command.startsWith('DATA')) { inData = true; socket.write('354 end data with <CRLF>.<CRLF>\r\n') }
        else if (command.startsWith('QUIT')) { socket.write('221 2.0.0 bye\r\n'); socket.end() }
        else socket.write('250 2.0.0 ok\r\n')
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { resolve() })
  })
  const address = server.address() as AddressInfo
  try {
    const assembled = assembleLetter({ to: ['timur@example.test'], subject: 'smtp acceptance', text: 'body over the wire' }, config)
    if (!assembled.ok) throw new Error(assembled.message)
    const rendered = renderLetter(assembled.letter)
    const delivery = await sendViaSmtp({
      host: '127.0.0.1',
      port: address.port,
      user: 'accept-user',
      password: 'accept-secret',
      from: assembled.letter.from,
      recipients: assembled.letter.to,
      raw: rendered.raw,
      timeoutMs: 5_000,
      requireTls: false,
    })
    if (!transcript.some(line => line.toUpperCase().startsWith('AUTH LOGIN'))) throw new Error('no AUTH LOGIN on the wire')
    if (!transcript.some(line => line.toUpperCase().startsWith('DATA'))) throw new Error('no DATA on the wire')
    if (delivery.accepted.length !== 1 || delivery.rejected.length !== 0) throw new Error(`accepted=${delivery.accepted.length} rejected=${delivery.rejected.length}`)
    if (dataBytes === 0) throw new Error('DATA carried no bytes')
    return `AUTH+MAIL+RCPT+DATA+QUIT, ${dataBytes} body bytes, ${delivery.reply}`
  } finally {
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  }
}

/**
 * Assert a refusal carries an exact code.
 * @param outcome - the send outcome.
 * @param code - the expected code.
 */
function expectCode(outcome: SendFailure, code: SendFailure['code']): void {
  if (outcome.code !== code) throw new Error(`expected ${code}, received ${outcome.code}`)
}

/** Guards kept for the exported type surface. */
export type AcceptanceGuards = readonly MailGuard[]
