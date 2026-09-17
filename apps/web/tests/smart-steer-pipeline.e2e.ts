// Web e2e scenario for the Smart-steer visible reasoning pipeline: opening the
// advisor sheet reveals the four pipeline rows (pending → running → done) and a
// confidence-gated verdict. A status-probe row carries tier-1 confidence above
// the configured gate and reads as deliverable; an instruction row stays below
// the gate and defaults to keep-queued with its reason visible. The gate value
// itself is the durable smartSteerMinConfidence section field.
// Replay-only: the recorded steering fixture keeps the turn open while rows queue.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/steering', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const MODE = webSnapshotMode()
const REPLAY_PACE_MS = 500

const PROMPT = 'Use the ask_user_question tool to ask me exactly one question with id "checkpoint", question "Ready to continue?", header "Checkpoint", and options labeled "Yes" and "No". After I answer, reply with one short sentence acknowledging my answer and stop.'
// Short interrogative probe: the tier-1 rules classify it as a status question,
// whose confidence (0.97) reaches the default gate (0.95).
const PROBE_ROW = 'What is the current status?'
// Instruction wording: classified as defer, whose confidence (0.7) stays below
// the gate, so the sheet defaults to keep-queued.
const INSTRUCTION_ROW = 'Please also fix the login bug.'

describe.skipIf(MODE === 'record')('web e2e: smart steer pipeline panel reveals gated verdicts', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: REPLAY_PACE_MS, compareReplaySession: false })
    scaffold.ctx.on('session/event', (_session, event) => { sessionEvents.push(event) })
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
  })

  it('reveals the pipeline rows and gates both verdict classes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-smart-steer-pipeline'))
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill(PROMPT)
    await input.press('Enter')
    // The recorded turn must be in flight before queueing, or Enter would
    // queue instead of send; the question panel later hides the composer, so
    // both rows queue before it renders.
    await expect.poll(
      () => sessionEvents.some(event => event.type === 'request/context'),
      { timeout: 10_000 },
    ).toBe(true)
    const dock = page.locator('[data-queue-dock]')
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill(INSTRUCTION_ROW)
    await input.press('Enter')
    await input.fill(PROBE_ROW)
    await input.press('Enter')
    // Two rows default to a collapsed count header; expand it so the rows'
    // per-row actions are reachable.
    await dock.getByRole('button', { name: '2 queued messages' }).click({ timeout: 10_000 })
    const instructionRow = dock.getByRole('listitem').filter({ hasText: INSTRUCTION_ROW })
    await instructionRow.waitFor({ timeout: 10_000 })
    const rowSmart = instructionRow.getByRole('button', { name: 'Smart steer queued message', exact: true })
    await expect.poll(() => rowSmart.isEnabled(), { timeout: 10_000 }).toBe(true)
    await rowSmart.click({ timeout: 10_000 })
    const instructionSheet = page.getByRole('dialog', { name: 'Smart steer advisor' })
    await instructionSheet.waitFor({ timeout: 10_000 })
    const instructionPipeline = instructionSheet.getByRole('list', { name: 'Steer pipeline' })
    const firstRender = (await instructionPipeline.textContent()) ?? ''
    expect(firstRender).toContain('Running')
    expect(firstRender).toContain('Pending')
    await expect.poll(async () => {
      const text = (await instructionPipeline.textContent()) ?? ''
      return [...text.matchAll(/Done/g)].length
    }, { timeout: 10_000 }).toBe(4)
    const settledPipeline = (await instructionPipeline.textContent()) ?? ''
    expect(settledPipeline).toContain('Session status probe')
    expect(settledPipeline).toContain('Input analysis')
    expect(settledPipeline).toContain('Risk assessment')
    expect(settledPipeline).toContain('Verdict')
    const gateText = (await instructionSheet.textContent()) ?? ''
    expect(gateText).toContain('Confidence 70% — Below the gate: kept queued by default.')
    expect(gateText).toContain('Advise defer: delivered at the next step boundary; the running turn continues undisturbed.')
    // The reasoning line explains the hold: an instruction, not a probe.
    expect(settledPipeline).toContain('Reads as a real instruction, not a status probe')
    expect(settledPipeline).toContain('Confidence 70% is below the gate — keep queued')
    await instructionSheet.getByRole('button', { name: 'Keep queued' }).click()
    await expect.poll(() => page.getByRole('dialog', { name: 'Smart steer advisor' }).count(), { timeout: 10_000 })
      .toBe(0)
    expect(await instructionRow.count()).toBe(1)

    // The probe row's confidence reaches the gate and its sheet reads
    // deliverable; the override then delivers through the ordinary steer.
    const probeRow = dock.getByRole('listitem').filter({ hasText: PROBE_ROW })
    await probeRow.waitFor({ timeout: 10_000 })
    const smartButton = probeRow.getByRole('button', { name: 'Smart steer queued message', exact: true })
    await expect.poll(() => smartButton.isEnabled(), { timeout: 10_000 }).toBe(true)
    await smartButton.click({ timeout: 10_000 })
    const probeSheet = page.getByRole('dialog', { name: 'Smart steer advisor' })
    await probeSheet.waitFor({ timeout: 10_000 })
    const probePipeline = probeSheet.getByRole('list', { name: 'Steer pipeline' })
    await expect.poll(async () => {
      const text = (await probePipeline.textContent()) ?? ''
      return [...text.matchAll(/Done/g)].length
    }, { timeout: 10_000 }).toBe(4)
    expect(await probeSheet.textContent()).toContain('Confidence 97% — At the gate: delivery allowed.')
    // The probe's reasoning chain explains the allowance end to end.
    const probeSettled = (await probePipeline.textContent()) ?? ''
    expect(probeSettled).toContain('Agent is running with 2 message(s) queued')
    expect(probeSettled).toContain('Short interrogative probe; the snapshot above already answers it')
    expect(probeSettled).toContain('Delivery now would only interrupt the running turn')
    expect(probeSettled).toContain('Confidence 97% meets the gate — delivery allowed')

    // Deliver: the steer drains once the composer question is answered, the
    // recorded continuation completes, and the replay fixture is fully consumed.
    const turnSettled = scaffold.whenTurnSettled(30_000)
    await probeSheet.getByRole('button', { name: 'Send now anyway' }).click({ timeout: 10_000 })
    const pendingSteering = page.locator('[data-pending-steering]').filter({ hasText: PROBE_ROW })
    await pendingSteering.waitFor({ timeout: 10_000 })
    await expect.poll(() => page.getByRole('dialog', { name: 'Smart steer advisor' }).count(), { timeout: 10_000 })
      .toBe(0)
    const composer = page.locator('[data-question-key]')
    await composer.getByRole('radio', { name: 'Yes' }).click()
    await composer.getByRole('radio', { name: 'Yes' }).press('Enter')
    await turnSettled
    expect(await pendingSteering.count()).toBe(0)
    expect(await page.locator('[data-queue-dock]').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 200_000)
})
