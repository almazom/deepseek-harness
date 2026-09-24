// TEMPORARY diagnostic (not part of the p2i deliverable): capture operator-facing
// visual evidence of the armed 60s countdown on the collective-decision row at the
// 390x664 phone seat. The reviewed e2e asserts the geometry and the decrement; this
// file only writes the PNG. Asked straight through the userQuestions seam because
// the replayed fixture predates the host-side autoDecide injection.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/question-composer', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const SHOT = process.env['DSH_SHOT_PATH'] ?? '/tmp/countdown-390x664.png'
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('diagnostic: countdown shot at 390x664', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let sessionId: SessionId | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false })
    scaffold.ctx.on('session/event', (session) => { sessionId ??= session.id })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('writes the PNG with the countdown armed', async () => {
    // One replayed turn so a live agent exists for the seam ask.
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    await input.fill('ask me the color question')
    await input.press('Enter')
    const first = page.locator('[data-question-key]')
    await first.waitFor({ timeout: 30_000 })
    await first.getByRole('button', { name: 'Skip this question' }).click()
    await expect.poll(() => page.locator('[data-question-key]').count(), { timeout: 20_000 }).toBe(0)
    expect(sessionId).toBeDefined()

    const agent = scaffold.ctx.agents.get(sessionId as SessionId)
    expect(agent).toBeDefined()
    const asked = scaffold.ctx.userQuestions.ask({
      agent: agent as NonNullable<typeof agent>,
      questions: [{
        id: 'shot',
        header: 'Seat',
        question: 'Which seat shape should the card use?',
        options: [
          { label: 'Desktop card', recommended: true },
          { label: 'Collective decision (brainstorm)', autoDecide: true },
        ],
      }],
    })

    await page.setViewportSize({ width: 390, height: 664 })
    const composer = page.locator('[data-question-key]')
    await composer.waitFor({ timeout: 30_000 })
    const timer = composer.locator('[data-countdown]')
    await timer.waitFor({ timeout: 10_000 })
    // Take the shot a few seconds in, so the bar is part-drained and the figure
    // is visibly not 60s — a still of the start would not show it running.
    await new Promise(resolve => setTimeout(resolve, 4000))
    const read = await composer.evaluate((root) => {
      const card = root.querySelector<HTMLElement>('[data-question-card]') ?? root
      const box = card.getBoundingClientRect()
      const pill = root.querySelector<HTMLElement>('[data-countdown]')
      return {
        countdown: pill?.textContent ?? null,
        dataCountdown: pill?.getAttribute('data-countdown') ?? null,
        barWidth: pill?.querySelector<HTMLElement>('span')?.style.width ?? null,
        cardTop: Math.round(box.top),
        cardBottom: Math.round(box.bottom),
        viewportHeight: window.innerHeight,
        below: [...card.querySelectorAll<HTMLElement>('button')]
          .filter(button => button.getBoundingClientRect().bottom > window.innerHeight + 0.5)
          .map(button => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().slice(0, 30)),
      }
    })
    await page.screenshot({ path: SHOT })
    console.log(`SHOT[390x664] ${JSON.stringify(read)} -> ${SHOT}`)

    await composer.getByRole('button', { name: 'Skip this question' }).click()
    await expect.poll(() => page.locator('[data-question-key]').count(), { timeout: 20_000 }).toBe(0)
    expect(asked).toBeDefined()
  }, 120_000)
})
