import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildDigest, digestLine, extractText } from '../src/digest.ts'

const event = (type: string, seq: number, data?: unknown): SessionEvent =>
  ({ type, seq, time: 0, data }) as unknown as SessionEvent

describe('digestLine', () => {
  it('quotes operator input verbatim, clipped to 400 chars', () => {
    const long = 'x'.repeat(500)
    const line = digestLine(
      event('user/message', 3, { content: [{ type: 'text', text: long }] }),
    )
    expect(line).toEqual({ seq: 3, text: 'x'.repeat(400) })
  })

  it('returns null when the user message carries no text', () => {
    expect(digestLine(event('user/message', 4, { content: [] }))).toBeNull()
    expect(digestLine(event('user/message', 4, { content: [{ type: 'image' }] }))).toBeNull()
    expect(digestLine(event('user/message', 4))).toBeNull()
  })

  it('quotes a compaction summary verbatim with a [summary] marker', () => {
    const line = digestLine(
      event('compaction/summary', 9, { summary: [{ type: 'text', text: 'sealed route' }] }),
    )
    expect(line).toEqual({ seq: 9, text: '[summary] sealed route' })
  })

  it('collapses tool traffic to a one-character direction marker', () => {
    expect(digestLine(event('tool/call', 5, { name: 'bash' }))).toEqual({
      seq: 5,
      text: '> bash',
    })
    expect(digestLine(event('tool/result', 6, { toolName: 'read' }))).toEqual({
      seq: 6,
      text: '< read',
    })
    expect(digestLine(event('tool/call', 7, {}))).toEqual({ seq: 7, text: '> tool' })
  })

  it('drops events that carry nothing worth labeling', () => {
    expect(digestLine(event('turn/start', 1, { turn: 1 }))).toBeNull()
    expect(digestLine(event('session/semantic-map', 8, { units: [] }))).toBeNull()
  })
})

describe('buildDigest', () => {
  it('keeps every line that fits the token budget (tokens x 4 chars)', () => {
    const lines = [
      { seq: 1, text: 'aaaa' },
      { seq: 2, text: 'bb' },
      { seq: 3, text: 'cc' },
    ]
    expect(buildDigest(lines, 10)).toEqual({
      text: 'aaaa\nbb\ncc',
      truncated: false,
      consumed: 3,
    })
  })

  it('stops at the first overflowing line and reports the consumed prefix (AC3)', () => {
    const lines = [
      { seq: 1, text: 'aaaa' },
      { seq: 2, text: 'bb' },
      { seq: 3, text: 'cc' },
    ]
    expect(buildDigest(lines, 2)).toEqual({
      text: 'aaaa\nbb',
      truncated: true,
      consumed: 2,
    })
  })

  it('keeps a clipped prefix of a single oversized line so the scan progresses', () => {
    expect(buildDigest([{ seq: 1, text: 'abcdefghij' }], 1)).toEqual({
      text: 'abcd',
      truncated: true,
      consumed: 1,
    })
  })

  it('returns an empty result for an empty line list', () => {
    expect(buildDigest([], 10)).toEqual({ text: '', truncated: false, consumed: 0 })
  })
})

describe('extractText', () => {
  it('handles strings, block arrays, string arrays, and non-text payloads', () => {
    expect(extractText('plain')).toBe('plain')
    expect(extractText([{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }])).toBe('one two')
    expect(extractText(['a', 'b'])).toBe('a b')
    expect(extractText([{ type: 'image' }])).toBe('')
    expect(extractText({ nope: true })).toBe('')
    expect(extractText(undefined)).toBe('')
  })
})
