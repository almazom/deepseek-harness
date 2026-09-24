// TEMPORARY PROBE (operator task 2026-09-24): measure the resident question
// composer at a phone viewport (390x664) against the SAME replayed fixture the
// question-composer golden uses, so the "buttons not visible on mobile" report
// is reproduced as measured geometry instead of a guess.
// Setup runs on the known-good desktop path, then the viewport is squeezed
// before the prompt is typed, so the composer is laid out at phone width.
// Not a golden: it asserts nothing about layout and only dumps numbers + shots.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, fixtureUserPrompts, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/question-composer', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const PHONE = { width: 390, height: 664 }

const PROMPT = 'Use the ask_user_question tool to ask me exactly one multi-select question with id "color", question "Which color do you prefer?", header "Pick one", and two options: label "Blue" with description "A cool recessive hue that reads as calm and trustworthy in long reading sessions and dense dashboards.", and label "Green" with description "A restful mid-spectrum hue with the highest perceived brightness, easiest on the eye over long sessions." Set multi_select to true. After I answer, reply with the single word DONE and stop.'

/** Measure the question card and its interactive descendants against the viewport. */
async function measure(page: Page, tag: string): Promise<void> {
  const info = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('[data-question-key]')
    if (card === null) return { error: 'no card' }
    const box = (el: Element | null) => {
      if (el === null) return null
      const b = el.getBoundingClientRect()
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }
    }
    const scroll = card.querySelector<HTMLElement>('[data-question-scroll]')
    const rows = [...card.querySelectorAll<HTMLElement>('[role="radio"], [role="checkbox"]')]
    const buttons = [...card.querySelectorAll<HTMLElement>('button')]
    const vv = window.visualViewport
    return {
      viewport: { innerW: window.innerWidth, innerH: window.innerHeight },
      visualViewport: vv === null ? null : { h: Math.round(vv.height), top: Math.round(vv.offsetTop) },
      card: box(card),
      scrollBox: box(scroll),
      scrollScrolls: scroll === null ? null : scroll.scrollHeight > scroll.clientHeight,
      rows: rows.map(r => ({ label: (r.textContent ?? '').slice(0, 14), ...box(r), onScreen: (box(r)?.bottom ?? 0) <= window.innerHeight })),
      buttons: buttons.map(b => ({ text: (b.textContent ?? '').trim().slice(0, 18), ...box(b), onScreen: (box(b)?.bottom ?? 0) <= window.innerHeight })),
    }
  })
  process.stdout.write(`\nPROBE[${tag}] ${JSON.stringify(info, null, 2)}\n`)
  await page.screenshot({ path: `/tmp/qmobile-${tag}.png` })
}

describe('mobile question composer geometry probe', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    // compareReplaySession stays off: this probe answers WITHOUT the fixture's
    // recorded free-text, so the persisted session is deliberately not the golden.
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await page.setViewportSize(PHONE)
    await page.waitForTimeout(400)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('measures the pending question card at 390x664', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-question-mobile-probe'))
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled(30_000)
    await input.fill(PROMPT)
    await input.press('Enter')

    const card = page.locator('[data-question-key]')
    await card.waitFor({ timeout: 30_000 })
    await expect.poll(() => card.getByText('Which color do you prefer?').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await measure(page, 'pending-390x664')

    // The realistic phone state while the on-screen keyboard is up.
    await card.getByRole('textbox').click()
    await page.waitForTimeout(300)
    await measure(page, 'focused-390x664')

    // Also measure the desktop seat for contrast.
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.waitForTimeout(300)
    await measure(page, 'desktop-1680x1000')

    // Resolve the request so the replayed turn can settle (the probe asserts layout only).
    await card.getByRole('checkbox', { name: 'Blue' }).click()
    await card.getByRole('button', { name: /submit|answer|next/i }).last().click()
    await settled
  }, 90_000)
})
