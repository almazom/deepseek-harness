import { describe, expect, it } from 'vitest'
import { LETTER_WIDTH, darkModeCss, htmlToText, renderHtmlLetter, renderThemedLetter } from '../src/html.ts'

describe('html', () => {
  it('inlines every style a sent letter needs', () => {
    const html = renderHtmlLetter({ title: 'Hi', paragraphs: ['one', 'two'], locale: 'ru' })
    expect(html).toContain('<html')
    expect(html).not.toContain('<style')
    expect(html).toContain('style="')
    expect(html).toContain(`max-width:${LETTER_WIDTH}px`)
    expect(html).toContain('color-scheme')
  })

  it('adds the preview-only style block when asked', () => {
    const html = renderHtmlLetter({ title: 'Hi', paragraphs: ['one'], includeStyleBlock: true })
    expect(html).toContain('<style')
    expect(html).toContain('prefers-color-scheme: dark')
    expect(darkModeCss()).toContain('prefers-color-scheme: dark')
  })

  it('escapes markup in the input', () => {
    const html = renderHtmlLetter({ title: '<script>', paragraphs: ['a & b'] })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&amp;')
  })

  it('keeps the template text as the plain-text alternative', () => {
    const themed = renderThemedLetter('test-letter', 'en', { stamp: 'now', transport: 'console' })
    expect(themed.ok).toBe(true)
    if (!themed.ok) return
    expect(themed.text).toContain('now')
    expect(themed.html).toContain('now')
    expect(themed.subject.length).toBeGreaterThan(0)
    expect(htmlToText(themed.html)).not.toContain('<p')
  })
})
