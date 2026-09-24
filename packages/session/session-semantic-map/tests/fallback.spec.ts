/**
 * The deterministic no-provider fallback: operator-turn windows become
 * `direction` units labeled from compaction summary titles (or `# N` order
 * labels when no title covers the turn), every window but the last starts
 * sealed, and repeated builds over the same input are equal.
 */

import { describe, expect, it } from 'vitest'
import { fallbackUnits } from '../src/fallback.ts'

describe('fallbackUnits', () => {
  it('labels user windows deterministically (card model case)', () => {
    const out = fallbackUnits([1, 10], new Map([[1, 'Title A']]))
    expect(out[0]!.label).toBe('Title A')
    expect(out[1]!.label).toBe('# 2')
    expect(out[0]!.sealed).toBe(true)
    expect(out[1]!.sealed).toBe(false)
  })

  it('spans each window to the next turn and stamps the unit shape', () => {
    const out = fallbackUnits([1, 10], new Map<number, string>())
    expect(out[0]!.id).toBe('d-1')
    expect(out[0]!.kind).toBe('direction')
    expect(out[0]!.fromSeq).toBe(1)
    expect(out[0]!.toSeq).toBe(10)
    expect(out[1]!.fromSeq).toBe(10)
    expect(out[1]!.toSeq).toBe(10)
    expect(out.every(entry => entry.eventCount === 1)).toBe(true)
  })

  it('produces order labels when no summary title covers a turn', () => {
    const out = fallbackUnits([4, 8, 12], new Map<number, string>())
    expect(out.map(entry => entry.label)).toEqual(['# 1', '# 2', '# 3'])
  })

  it('returns an empty list for a session without operator turns', () => {
    expect(fallbackUnits([], new Map<number, string>())).toEqual([])
  })
})
