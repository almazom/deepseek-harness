// Web e2e scenario for the Smart-steer advisor sheet: the dock's fourth row
// action opens the bottom sheet over the live session, the snapshot fields read
// the running state, the queue, and the newest human input, and the tier-1
// status verdict still leaves the override to the operator. Send-now reuses the
// ordinary queue steer, so the interjection lands as one durable claimed
// user/message and the recorded continuation replies with the marker word.
// Replay-only: the recorded steering fixture drives both model calls.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { expandAssistantStream } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/steering', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const MODE = webSnapshotMode()
const REPLAY_PACE_MS = 500

const PROMPT = 'Use the ask_user_question tool to ask me exactly one question with id "checkpoint", question "Ready to continue?", header "Checkpoint", and options labeled "Yes" and "No". After I answer, reply with one short sentence acknowledging my answer and stop.'
// Status-probe wording on purpose: the tier-1 advisor answers it from the
// snapshot with the status verdict, and the marker word proves the override
// delivery obeyed the recorded continuation.
const QUEUED = 'What is the current status — reply with BANANA?'

/** Concatenated assistant text deltas — the model-visible reply body. */
function assistantText(events: SessionEvent[]): string {
  return events
    .flatMap(e => e.type === 'assistant/message' || e.type === 'assistant/attempt'
      ? expandAssistantStream(e.data.stream)
      : [])
    .map(({ chunk }) => chunk.type === 'text-delta' ? chunk.text : '')
    .join('')
}

/** Claimed user messages whose payload contains the exact scenario text. */
function claimedMessages(events: readonly SessionEvent[], text: string): SessionEvent<'user/message'>[] {
  return events.filter((event): event is SessionEvent<'user/message'> =>
    event.type === 'user/message' && JSON.stringify(event.data.content).includes(text))
}

describe.skipIf(MODE === 'record')('web e2e: smart steer advisor sheet gates the delivery', () => {
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

  it('opens the advisor sheet, then sends the queued row through the override', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-smart-steer'))
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled(30_000)
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill(PROMPT)
    await input.press('Enter')
    await expect.poll(
      () => sessionEvents.some(event => event.type === 'request/context'),
      { timeout: 10_000 },
    ).toBe(true)

    // Queue the probe row while the question tool keeps the turn open.
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill(QUEUED)
    await input.press('Enter')
    const queuedRow = page.locator('[data-queue-dock]').getByRole('listitem').filter({ hasText: QUEUED })
    await queuedRow.waitFor({ timeout: 10_000 })

    // The advisor sheet reads the live snapshot: running state, queue size,
    // the advised row, the newest human input, and the tier-1 status verdict.
    const smartButton = queuedRow.getByRole('button', { name: 'Smart steer queued message', exact: true })
    const steerButton = queuedRow.getByRole('button', { name: 'Steer queued message', exact: true })
    expect(await queuedRow.getByRole('button').evaluateAll((buttons) => {
      const index = (name: string) => buttons.findIndex(button => button.getAttribute('aria-label') === name)
      return index('Steer queued message') >= 0 && index('Steer queued message') < index('Smart steer queued message')
    })).toBe(true)
    expect(await steerButton.count()).toBe(1)
    await expect.poll(() => smartButton.isEnabled(), { timeout: 10_000 }).toBe(true)
    await smartButton.click({ timeout: 10_000 })
    const sheet = page.getByRole('dialog', { name: 'Smart steer advisor' })
    await sheet.waitFor({ timeout: 10_000 })
    const sheetText = await sheet.textContent()
    expect(sheetText).toContain('Running')
    expect(sheetText).toContain('1')
    expect(sheetText).toContain(QUEUED)
    expect(sheetText).toContain('Last human input')
    expect(sheetText).toContain('Advisor verdict')
    expect(sheetText).toContain('status question')

    // Keep-queued is the protective default action: close without delivering.
    await sheet.getByRole('button', { name: 'Keep queued' }).click()
    await expect.poll(() => page.getByRole('dialog', { name: 'Smart steer advisor' }).count(), { timeout: 10_000 })
      .toBe(0)
    expect(await queuedRow.count()).toBe(1)

    // Reopen and override: the sheet routes through the ordinary queue steer,
    // the row leaves the dock, and the interjection renders as pending steering.
    await smartButton.click({ timeout: 10_000 })
    await page.getByRole('dialog', { name: 'Smart steer advisor' })
      .getByRole('button', { name: 'Send now anyway' })
      .click({ timeout: 10_000 })
    const pendingSteering = page.locator('[data-pending-steering]').filter({ hasText: QUEUED })
    // A timeout while the Queue row remains means the command observed a
    // stopped Agent (`steer-unavailable`); inspect replay pacing first.
    await pendingSteering.waitFor({ timeout: 10_000 })
    await expect.poll(() => page.getByRole('dialog', { name: 'Smart steer advisor' }).count(), { timeout: 10_000 })
      .toBe(0)

    // Answer the composer; the step closes, the steer drains as user/message,
    // and the recorded continuation replies with the marker word.
    const composer = page.locator('[data-question-key]')
    await composer.waitFor({ timeout: 30_000 })
    await composer.getByRole('radio', { name: 'Yes' }).click()
    await composer.getByRole('radio', { name: 'Yes' }).press('Enter')
    await settled

    const steerEvents = claimedMessages(sessionEvents, QUEUED)
    expect(steerEvents).toHaveLength(1)
    const turnEnds = sessionEvents.filter(e => e.type === 'turn/end')
    expect(turnEnds).toHaveLength(1)
    expect((turnEnds[0] as SessionEvent & { data: { reason: { kind: string } } }).data.reason.kind).toBe('completed')
    await expect.poll(() => page.getByText(QUEUED, { exact: true }).count(), { timeout: 15_000 }).toBe(1)
    expect(await pendingSteering.count()).toBe(0)
    expect(await page.locator('[data-queue-dock]').count()).toBe(0)
    expect(assistantText(sessionEvents)).toContain('BANANA')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 200_000)
})
