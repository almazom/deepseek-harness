// Web e2e scenario for the Smart-steer advisor side run: pressing a queued
// row's smart button opens the advisor sheet, the mounted dispatcher streams
// the scripted advisory side run from the replay child fixture, and the sheet
// completes its phase rows AS THE MODEL WORKS — each row carries the model's
// verbatim finding (no timer reveal), then the verdict lands with the gate
// comparison and the promote action. Host-side assertions read the advisor/*
// session events to pin the log as the projection source.
// Replay-only: the steering fixture keeps the turn open while the row queues.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const STEERING_FIXTURE = fileURLToPath(new URL('../../../snapshots/web/steering/session.v3.jsonl', import.meta.url))
// The scenario boots the shipped Web composition, whose queue-advisor row
// resolves through the web-app bundle's dependency closure (the scaffold's
// default install anchor is the CLI app, which does not mount the advisor).
const WEB_APP_MANIFEST = fileURLToPath(new URL('../../../packages/bundle/web-app/package.json', import.meta.url))
const MODE = webSnapshotMode()
const REPLAY_PACE_MS = 500
// Instruction wording: consistent with the running task, so the scripted
// advisory verdict (0.97) reaches the default gate (0.95) and the sheet
// reads the run as deliverable.
const INSTRUCTION_ROW = 'Also run the typecheck after the fix.'

// The advisory JSON the scripted side run streams, split at section closings
// so the sheet's phase rows land one by one exactly as the model emits them.
const ADVISOR_SECTIONS = [
  '{"tail": {"finding": "The agent turn is waiting on an ask_user_question checkpoint."}',
  ',"compare": {"finding": "The queued typecheck request extends the running fix instead of contradicting it."}',
  ',"risk": {"finding": "Sending it now would interleave typecheck output with the pending checkpoint answer."}',
  ',"verdict": {"kind": "send-now"',
  ',"confidence": 0.97',
  ',"reason": "The queued typecheck request matches the task and can run next."}}',
] as const
const ADVISOR_TEXT = ADVISOR_SECTIONS.join('')

/** Build the one-call side-run session log the anonymous replay slot serves. */
function advisorChildFixture(): string {
  const base = 1788699500000
  const stream: unknown[] = [
    { type: 'chunk', time: base, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    ...ADVISOR_SECTIONS.map((text, index) => ({
      type: 'text-chunks', time0: base + (index + 1) * 200, index: 0, dt: [], texts: [text],
    })),
    {
      type: 'chunk', time: base + 2000,
      chunk: { type: 'block-end', index: 0, block: { type: 'text', text: ADVISOR_TEXT } },
    },
    {
      type: 'chunk', time: base + 2400,
      chunk: { type: 'usage', usage: { inputTokens: 120, outputTokens: 80 } },
    },
    { type: 'chunk', time: base + 2800, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]
  const header = {
    type: 'session', version: 3, id: 'advisor-run-side-run', createdAt: 1788240428600,
    cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0, agentPreset: 'standard',
  }
  const turnStart = { type: 'turn/start', data: { turn: 1 } }
  const stepStart = { type: 'step/start', data: { turn: 1, step: 1 } }
  const stepEnd = { type: 'step/end', data: { turn: 1, step: 1 } }
  const turnEnd = { type: 'turn/end', data: { turn: 1 } }
  const message = {
    type: 'assistant/message',
    data: {
      turn: 1, step: 1,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: ADVISOR_TEXT }],
        source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash' },
        id: 'advisor-run-message-1',
      },
      usage: { inputTokens: 120, outputTokens: 80 },
      stream,
    },
    surfaceOp: 'append',
  }
  return [
    JSON.stringify(header), JSON.stringify(turnStart), JSON.stringify(stepStart),
    JSON.stringify(message), JSON.stringify(stepEnd), JSON.stringify(turnEnd),
  ].join('\n') + '\n'
}

describe.skipIf(MODE === 'record')('web e2e: smart steer advisor side run streams its phases', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let replayDir: string
  const sessionEvents: SessionEvent[] = []
  const advisorEvents: SessionEvent[] = []

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-smart-steer-advisor-'))
    const childFixture = join(replayDir, 'advisor-run.v3.jsonl')
    await writeFile(childFixture, advisorChildFixture())
    scaffold = await launchWebScaffold({
      replayFixture: STEERING_FIXTURE,
      replayChildFixtures: [childFixture],
      extraInstallAnchors: [WEB_APP_MANIFEST],
      paceMs: REPLAY_PACE_MS,
      compareReplaySession: false,
    })
    scaffold.ctx.on('session/event', (_session, event) => {
      sessionEvents.push(event)
      if (event.type.startsWith('advisor/')) advisorEvents.push(event)
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    await rm(replayDir, { recursive: true, force: true })
  })

  it('completes the sheet phases as the model streams and gates the verdict', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-smart-steer-advisor'))
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    // Put the recorded turn in flight (the question panel later hides the
    // composer) before queueing the row the advisor decides about.
    await input.fill('Use the ask_user_question tool to ask me one question and wait for my answer.')
    await input.press('Enter')
    // The recorded turn must be in flight before queueing, or Enter would
    // queue instead of send.
    await expect.poll(
      () => sessionEvents.some(event => event.type === 'request/context'),
      { timeout: 10_000 },
    ).toBe(true)
    const dock = page.locator('[data-queue-dock]')
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill(INSTRUCTION_ROW)
    await input.press('Enter')
    // A single queued row renders directly; only multiple rows collapse
    // behind a count header.
    const instructionRow = dock.getByRole('listitem').filter({ hasText: INSTRUCTION_ROW })
    await instructionRow.waitFor({ timeout: 10_000 })
    const rowSmart = instructionRow.getByRole('button', { name: 'Smart steer queued message', exact: true })
    await expect.poll(() => rowSmart.isEnabled(), { timeout: 10_000 }).toBe(true)
    await rowSmart.click({ timeout: 10_000 })
    const sheet = page.getByRole('dialog', { name: 'Smart steer advisor' })
    await sheet.waitFor({ timeout: 10_000 })

    // The side run starts from the button press: while the stream is in
    // flight the gate and verdict rows show their pending copy, and phase
    // rows appear one by one with the model's verbatim findings.
    await expect.poll(() => sheet.textContent(), { timeout: 10_000 }).toContain(
      'Advisory side run reading the session snapshot…',
    )
    await expect.poll(() => sheet.textContent(), { timeout: 20_000 }).toContain(
      'Waiting for the advisory verdict…',
    )
    await expect.poll(() => sheet.textContent(), { timeout: 20_000 }).toContain(
      'The agent turn is waiting on an ask_user_question checkpoint.',
    )
    await expect.poll(() => sheet.textContent(), { timeout: 20_000 }).toContain(
      'The queued typecheck request extends the running fix instead of contradicting it.',
    )
    await expect.poll(() => sheet.textContent(), { timeout: 20_000 }).toContain(
      'Sending it now would interleave typecheck output with the pending checkpoint answer.',
    )
    // The verdict lands last: the gate line switches to the live confidence,
    // the verdict reason is the model's sentence, and the promote action
    // unlocks because 0.97 clears the configured gate.
    await expect.poll(() => sheet.textContent(), { timeout: 20_000 }).toContain(
      'Confidence 97% — At the gate: delivery allowed.',
    )
    await expect.poll(() => sheet.textContent(), { timeout: 10_000 }).toContain(
      'The queued typecheck request matches the task and can run next.',
    )
    const sendNow = sheet.getByRole('button', { name: 'Send now anyway' })
    await expect.poll(() => sendNow.isEnabled(), { timeout: 10_000 }).toBe(true)

    // The projection is the log: exactly one run walked requested → three
    // steps → verdict, with the steps carrying the streamed findings verbatim.
    const types = advisorEvents.map(event => event.type)
    expect(types[0]).toBe('advisor/run-requested')
    expect(types.filter(kind => kind === 'advisor/run-requested')).toHaveLength(1)
    expect(types.slice(1)).toEqual(['advisor/step', 'advisor/step', 'advisor/step', 'advisor/verdict'])
    // The request event carries the framed snapshot instead of a run id; the
    // phase events own the id and all share one run's.
    const runId = (advisorEvents[advisorEvents.length - 1]!.data as { runId: string }).runId
    for (const event of advisorEvents.filter(kind => kind.type !== 'advisor/run-requested')) {
      expect((event.data as { runId: string }).runId).toBe(runId)
    }
    const stepFindings = advisorEvents
      .filter(event => event.type === 'advisor/step')
      .map(event => (event.data as { step: string; finding: string }).finding)
    expect(stepFindings).toEqual([
      'The agent turn is waiting on an ask_user_question checkpoint.',
      'The queued typecheck request extends the running fix instead of contradicting it.',
      'Sending it now would interleave typecheck output with the pending checkpoint answer.',
    ])
    const verdictEvent = advisorEvents[advisorEvents.length - 1]!
    expect(verdictEvent.type).toBe('advisor/verdict')
    expect(verdictEvent.data).toMatchObject({
      runId, kind: 'send-now', confidence: 0.97,
      reason: 'The queued typecheck request matches the task and can run next.',
    })
    expect(advisorEvents.some(event => event.type === 'advisor/failed')).toBe(false)

    // Keep the row queued: the scenario's subject is the live run, not the
    // delivery. The question panel hides the queue dock, so the row's own
    // visibility returns only after the answer lets the turn continue; the
    // kept row then delivers as steering and the dock drains.
    await sheet.getByRole('button', { name: 'Keep queued' }).click()
    await expect.poll(() => page.getByRole('dialog', { name: 'Smart steer advisor' }).count(), { timeout: 10_000 })
      .toBe(0)
    const turnSettled = scaffold.whenTurnSettled(30_000)
    const composer = page.locator('[data-question-key]')
    await composer.getByRole('radio', { name: 'Yes' }).click()
    await composer.getByRole('radio', { name: 'Yes' }).press('Enter')
    await turnSettled
    await expect.poll(() => page.locator('[data-queue-dock]').count(), { timeout: 10_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 200_000)
})
