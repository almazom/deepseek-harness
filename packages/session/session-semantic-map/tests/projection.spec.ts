/**
 * The `semanticMap` fold invariants: a `sealed: true` unit keeps its label
 * across refreshes while the open tail may be re-cut, the watermark only
 * ever advances (including across null gaps), snapshot metadata
 * (`logVersion`/`updatedAt`) passes through untouched — append gating
 * belongs to the refresh service (TC-003) — and foreign events return the
 * identical state reference the projection contract requires. A real-registry
 * composition mounts the plugin beside SessionStore + SessionProjectionRegistry
 * and folds appended sidecar events through the live seam.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SemanticMapPlugin from '../src/index.ts'
import { semanticMapProjectionDefinition } from '../src/projection.ts'
import type { SemanticMapState, SemanticMapUnit } from '../src/types.ts'

/** A direction unit spanning `[fromSeq, fromSeq + 4]`. */
function unit(id: string, label: string, fromSeq: number, sealed: boolean): SemanticMapUnit {
  return {
    id,
    kind: 'direction',
    label,
    fromSeq: SessionSeq(fromSeq),
    toSeq: SessionSeq(fromSeq + 4),
    sealed,
    eventCount: 3,
  }
}

/** A sidecar snapshot with card-model defaults, overridden per fold. */
function sidecarState(units: SemanticMapUnit[], patch: Partial<SemanticMapState> = {}): SemanticMapState {
  return {
    units,
    openTailSeq: null,
    watermark: null,
    logVersion: 1,
    updatedAt: 1,
    ...patch,
  }
}

function sidecar(data: SemanticMapState): SessionEvent {
  return {
    type: 'session/semantic-map',
    seq: SessionSeq(1),
    time: 0,
    data,
  } as unknown as SessionEvent
}

function foreign(): SessionEvent {
  return { type: 'user/message', seq: SessionSeq(2), time: 0, data: {} } as unknown as SessionEvent
}

const INITIAL: SemanticMapState = { units: [], openTailSeq: null, watermark: null, logVersion: 0, updatedAt: 0 }
const def = semanticMapProjectionDefinition

describe('semanticMap fold invariants', () => {
  it('keeps a sealed unit\'s label while the watermark advances (card model case)', () => {
    const s1 = def.apply(INITIAL, sidecar(sidecarState(
      [unit('a', 'Plan', 1, true)],
      { openTailSeq: SessionSeq(5), watermark: SessionSeq(5), logVersion: 1, updatedAt: 1 },
    )))
    const s2 = def.apply(s1, sidecar(sidecarState(
      [unit('a', 'HACK', 1, true)],
      { openTailSeq: SessionSeq(9), watermark: SessionSeq(9), logVersion: 2, updatedAt: 2 },
    )))
    expect(s2.units[0]!.label).toBe('Plan')
    expect(s2.watermark).toBe(9)
  })

  it('re-cuts the open tail and accepts appended units around the sealed prefix', () => {
    const s1 = def.apply(INITIAL, sidecar(sidecarState(
      [unit('a', 'Plan', 1, true), unit('b', 'Tail v1', 6, false)],
      { openTailSeq: SessionSeq(6), watermark: SessionSeq(6) },
    )))
    // The previously open unit may even become sealed with a new label:
    // this state never sealed it, so the re-cut is legal.
    const s2 = def.apply(s1, sidecar(sidecarState(
      [unit('a', 'Plan', 1, true), unit('b', 'Tail v2', 6, true), unit('c', 'Newest tail', 11, false)],
      { openTailSeq: SessionSeq(11), watermark: SessionSeq(15) },
    )))
    expect(s2.units.map(entry => entry.label)).toEqual(['Plan', 'Tail v2', 'Newest tail'])
    expect(s2.units[0]!.sealed).toBe(true)
    expect(s2.units[2]!.sealed).toBe(false)
    expect(s2.openTailSeq).toBe(11)
  })

  it('never lets the watermark regress, including across null gaps', () => {
    const high = def.apply(INITIAL, sidecar(sidecarState([], { watermark: SessionSeq(9) })))
    expect(high.watermark).toBe(9)
    const regressed = def.apply(high, sidecar(sidecarState([], { watermark: SessionSeq(3) })))
    expect(regressed.watermark).toBe(9)

    const never = def.apply(INITIAL, sidecar(sidecarState([], { watermark: null })))
    expect(never.watermark).toBeNull()
    const first = def.apply(never, sidecar(sidecarState([], { watermark: SessionSeq(7) })))
    expect(first.watermark).toBe(7)
    const stillNull = def.apply(first, sidecar(sidecarState([], { watermark: null })))
    expect(stillNull.watermark).toBe(7)
  })

  it('returns the identical state reference for foreign events', () => {
    expect(def.apply(INITIAL, foreign())).toBe(INITIAL)
    const folded = def.apply(INITIAL, sidecar(sidecarState([unit('a', 'Plan', 1, true)])))
    expect(def.apply(folded, foreign())).toBe(folded)
  })

  it('passes logVersion and updatedAt through from the snapshot without self-increment', () => {
    const s1 = def.apply(INITIAL, sidecar(sidecarState([], { logVersion: 5, updatedAt: 500 })))
    expect(s1.logVersion).toBe(5)
    expect(s1.updatedAt).toBe(500)
    // The fold never bumps metadata on its own; it mirrors the append.
    const s2 = def.apply(s1, sidecar(sidecarState([], { logVersion: 5, updatedAt: 500 })))
    expect(s2.logVersion).toBe(5)
    expect(s2.updatedAt).toBe(500)
  })

  it('exposes the wire view as the state units reference', () => {
    const s1 = def.apply(INITIAL, sidecar(sidecarState([unit('a', 'Plan', 1, true)])))
    expect(def.wire.view(s1)).toBe(s1.units)
  })

  it('rejects a non-increasing unit order and unknown fields in the state schema', () => {
    const valid = sidecarState([unit('a', 'Plan', 1, true), unit('b', 'Tail', 6, false)])
    expect(def.stateSchema.parse(valid)).toEqual(valid)
    expect(() => def.stateSchema.parse(sidecarState([unit('b', 'Tail', 6, false), unit('a', 'Plan', 1, true)])))
      .toThrow(/strictly increasing/)
    expect(() => def.stateSchema.parse({ ...valid, extra: 1 })).toThrow()
  })
})

describe('semanticMap through the projection seam', () => {
  it('serves an empty map before any refresh and keeps seals across appended snapshots', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SemanticMapPlugin)
    const session = ctx.sessions.create(SessionId('semmap'))
    const view = (): readonly SemanticMapUnit[] =>
      ctx.sessionProjections.snapshot(session).values.semanticMap as readonly SemanticMapUnit[]
    expect(view()).toEqual([])

    session.append('session/semantic-map', sidecarState(
      [unit('a', 'Plan', 1, true), unit('b', 'Tail', 6, false)],
      { openTailSeq: SessionSeq(6), watermark: SessionSeq(9), logVersion: 1, updatedAt: 1 },
    ))
    expect(view()).toHaveLength(2)
    expect(view()[0]!.label).toBe('Plan')
    expect(view()[1]!.sealed).toBe(false)

    // A later refresh re-cutting the sealed unit is rejected through the live seam.
    session.append('session/semantic-map', sidecarState(
      [unit('a', 'HACK', 1, true), unit('b', 'Tail re-cut', 6, true)],
      { openTailSeq: SessionSeq(6), watermark: SessionSeq(15), logVersion: 2, updatedAt: 2 },
    ))
    expect(view().map(entry => entry.label)).toEqual(['Plan', 'Tail re-cut'])
  })
})
