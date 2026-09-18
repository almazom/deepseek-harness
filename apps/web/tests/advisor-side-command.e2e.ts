// Web e2e scenario for the /side (/btw) command: the empty-queue usage error
// names the supported flow, a queued row plus a typed "/btw <question>" starts
// the advisory run with a success card, and the advisor sheet AUTO-OPENS for
// the command-initiated run (no smart-button click) so the streamed verdict is
// readable; Escape dismisses it and the smart button still reopens on demand.
// Playwright screenshots land in .goal-evidence/ when DSH_GOAL_EVIDENCE is set.
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
const WEB_APP_MANIFEST = fileURLToPath(new URL('../../../packages/bundle/web-app/package.json', import.meta.url))
const MODE = webSnapshotMode()
const REPLAY_PACE_MS = 500
const INSTRUCTION_ROW = 'Also run the typecheck after the fix.'
const QUESTION = 'Did you check the failing log first?'
const EVIDENCE_DIR = fileURLToPath(new URL('../../../.goal-evidence/', import.meta.url))

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
  const base = 1788699600000
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
    type: 'session', version: 3, id: 'advisor-side-command-run', createdAt: 1788240428600,
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
        id: 'advisor-side-command-message-1',
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

describe.skipIf(MODE === 'record')('web e2e: /side command starts and surfaces the advisory run', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let replayDir: string
  const sessionEvents: SessionEvent[] = []
  const advisorEvents: SessionEvent[] = []
  let checks = 0
  const shot = async (name: string): Promise<void> => {
    if (process.env.DSH_GOAL_EVIDENCE === undefined) return
    await page.screenshot({ path: join(EVIDENCE_DIR, name), fullPage: false })
  }

  beforeAll(async () => {
    replayDir = await mkdtemp(join(tmpdir(), 'dsh-advisor-side-command-'))
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

  it('walks /side: usage error, queued row, command run, auto-opened sheet', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-advisor-side-command'))
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill('Use the ask_user_question tool to ask me one question and wait for my answer.')
    await input.press('Enter')
    await expect.poll(
      () => sessionEvents.some(event => event.type === 'request/context'),
      { timeout: 10_000 },
    ).toBe(true)
    const dock = page.locator('[data-queue-dock]')
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })

    // 1 — empty queue: the usage error names the supported flow.
    await input.fill('/side anything about the current step?')
    await input.press('Enter')
    await expect.poll(() => page.getByText('No queued message to ask about: queue a message while the turn runs, then ask again.').count(), { timeout: 10_000 })
      .toBe(1)
    expect(await page.getByText(/Usage: \/side <question>/).count()).toBe(1)
    checks += 1
    await shot('01-empty-queue-error.png')

    // 2 — queue the row the side question will ride.
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill(INSTRUCTION_ROW)
    await input.press('Enter')
    const instructionRow = dock.getByRole('listitem').filter({ hasText: INSTRUCTION_ROW })
    await instructionRow.waitFor({ timeout: 10_000 })
    checks += 1
    await shot('02-queued-row.png')

    // 3 — /btw starts the advisory run with a direct success card.
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill(`/btw ${QUESTION}`)
    await input.press('Enter')
    await expect.poll(
      () => advisorEvents.filter(event => event.type === 'advisor/run-requested').length,
      { timeout: 20_000 },
    ).toBe(1)
    const runRequest = advisorEvents.find(event => event.type === 'advisor/run-requested')
    expect(JSON.stringify(runRequest?.data)).toContain(QUESTION)
    expect(JSON.stringify(runRequest?.data)).toContain(INSTRUCTION_ROW)
    await expect.poll(
      () => page.getByText(`Advisor side run started for queued message "${INSTRUCTION_ROW}".`).count(),
      { timeout: 10_000 },
    ).toBe(1)
    checks += 1
    await shot('03-command-started.png')

    // 4 — the sheet AUTO-OPENS for the command-initiated run: no smart-button
    // click ever happened, yet the streamed verdict is readable.
    const sheet = page.getByRole('dialog', { name: 'Smart steer advisor' })
    await sheet.waitFor({ timeout: 10_000 })
    checks += 1
    await shot('04-sheet-auto-open.png')
    await expect.poll(() => sheet.textContent(), { timeout: 20_000 }).toContain(
      'The queued typecheck request matches the task and can run next.',
    )
    await expect.poll(() => sheet.textContent(), { timeout: 10_000 }).toContain(
      'Confidence 97% — At the gate: delivery allowed.',
    )
    checks += 1
    await shot('05-streamed-verdict.png')

    // 5 — Escape dismisses; the dismissed run never auto-reopens (the poll
    // window spans several replay ticks, so a misfiring effect would surface).
    await page.keyboard.press('Escape')
    await expect.poll(() => page.getByRole('dialog', { name: 'Smart steer advisor' }).count(), { timeout: 5_000 })
      .toBe(0)
    checks += 1
    await shot('06-dismissed-stays-closed.png')

    // 6 — answer the waiting checkpoint so the replayed main scene drives its
    // second recorded model call; the replay then consumes the queued row and
    // the dock drains, with the dismissed sheet never resurrecting.
    const composer = page.locator('[data-question-key]')
    await composer.getByRole('radio', { name: 'Yes' }).click()
    await composer.getByRole('radio', { name: 'Yes' }).press('Enter')
    await scaffold.whenTurnSettled(30_000)
    await expect.poll(() => page.locator('[data-queue-dock]').count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(() => page.getByRole('dialog', { name: 'Smart steer advisor' }).count(), { timeout: 5_000 })
      .toBe(0)
    checks += 1
    await shot('07-drained-after-answer.png')

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    checks += 1
    console.log(`PROOF TALLY: ${checks}/${checks} state checks passed, zero console errors`)
  }, 300_000)
})
