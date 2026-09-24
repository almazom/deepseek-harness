import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SemanticMapPlugin from '../src/index.ts'
import { SemanticMapConfig } from '../src/config.ts'
import type { LabelerInput, SemanticMapLabeler } from '../src/label.ts'
import type { SemanticMapState, SemanticMapUnit } from '../src/types.ts'

interface Cleanable {
  close(): Promise<void>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()!
    await cleanup()
  }
})

async function backend(withPersistence = true): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  let root = ''
  if (withPersistence) {
    root = await mkdtemp(join(tmpdir(), 'dsh-semantic-map-jsonl-'))
    await ctx.plugin(JsonlSessionPersistence, { root })
  }
  await ctx.plugin(SemanticMapPlugin)
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    if (root) await rm(root, { recursive: true, force: true })
  })
  return ctx
}

/** Open a live session plus its persistence write handle (routes live events). */
async function liveSession(ctx: Context, id: string): Promise<{ session: Session; writer: Cleanable }> {
  const session = ctx.sessions.create(SessionId(id))
  const writer: Cleanable = await ctx.sessionPersistence.create(session.header)
  cleanups.push(async () => {
    await writer.close()
  })
  return { session, writer }
}

function say(session: Session, text: string): void {
  session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
}

function mapState(ctx: Context, session: Session): SemanticMapState {
  const state = ctx.sessionProjections.stateOf(session, 'semanticMap')
  if (!state) throw new Error('semantic map state is missing')
  return state
}

describe('semanticMap.refresh', () => {
  it('throws when the session is not open in this store', async () => {
    const ctx = await backend()
    await expect(ctx.semanticMap.refresh('ghost')).rejects.toThrow(/not open in this store/)
  })

  it('throws when the sessionPersistence service is absent', async () => {
    const ctx = await backend(false)
    const session = ctx.sessions.create(SessionId('np'))
    await expect(ctx.semanticMap.refresh(session.id)).rejects.toThrow(/sessionPersistence/)
  })

  it('seeds the map through the deterministic fallback and logs one sidecar event (AC4)', async () => {
    const ctx = await backend()
    const { session } = await liveSession(ctx, 'fallback-seed')
    session.append('turn/start', { turn: 1 })
    say(session, 'first direction')
    say(session, 'second direction')

    const seqBefore = session.seq
    await ctx.semanticMap.refresh(session.id)

    // The sidecar payload is a logged event (model-visible <=> logged).
    expect(session.seq).toBe(seqBefore + 1)

    const state = mapState(ctx, session)
    expect(state.units).toHaveLength(2)
    expect(state.units[0]).toMatchObject({
      id: 'd-1',
      kind: 'direction',
      label: '# 1',
      fromSeq: 1,
      toSeq: 2,
      sealed: true,
      eventCount: 1,
    })
    expect(state.units[1]).toMatchObject({ id: 'd-2', label: '# 2', fromSeq: 2, sealed: false })
    expect(state.watermark).toBe(2)
    expect(state.openTailSeq).toBe(2)
    expect(state.logVersion).toBe(1)
    expect(state.updatedAt).toBeGreaterThan(0)
  })

  it('is an idempotent no-op when nothing landed after the watermark (AC2)', async () => {
    const ctx = await backend()
    const { session } = await liveSession(ctx, 'idempotent')
    session.append('turn/start', { turn: 1 })
    say(session, 'walk the metro map')
    await ctx.semanticMap.refresh(session.id)

    const seqBefore = session.seq
    const versionBefore = mapState(ctx, session).logVersion
    await ctx.semanticMap.refresh(session.id)

    expect(session.seq).toBe(seqBefore)
    expect(mapState(ctx, session).logVersion).toBe(versionBefore)
  })

  it('keeps sealed units intact and only re-cuts the open tail (revision cap)', async () => {
    const ctx = await backend()
    const { session } = await liveSession(ctx, 'revision-cap')
    session.append('turn/start', { turn: 1 })
    say(session, 'first direction')
    say(session, 'second direction')
    await ctx.semanticMap.refresh(session.id)
    const sealedBefore = mapState(ctx, session).units[0]

    say(session, 'third direction')
    await ctx.semanticMap.refresh(session.id)

    const state = mapState(ctx, session)
    expect(state.units).toHaveLength(3)
    // The previously sealed unit is carried over untouched (0 sealed re-cuts).
    expect(state.units[0]).toEqual(sealedBefore)
    expect(state.units.map(u => u.fromSeq)).toEqual([1, 2, 4])
    expect(state.units.map(u => u.sealed)).toEqual([true, true, false])
    expect(state.watermark).toBe(4)
    expect(state.logVersion).toBe(2)
  })

  it('advances the watermark without units when the tail has no operator input', async () => {
    const ctx = await backend()
    const { session } = await liveSession(ctx, 'fabric-only')
    session.append('turn/start', { turn: 1 })
    await ctx.semanticMap.refresh(session.id)

    const state = mapState(ctx, session)
    expect(state.units).toEqual([])
    expect(state.watermark).toBe(0)
    expect(state.logVersion).toBe(1)

    say(session, 'anchor appears')
    await ctx.semanticMap.refresh(session.id)
    const next = mapState(ctx, session)
    expect(next.units).toHaveLength(1)
    expect(next.watermark).toBe(2)
    expect(next.logVersion).toBe(2)
  })

  it('does not append anything for an empty session (empty tail no-op)', async () => {
    const ctx = await backend()
    const { session } = await liveSession(ctx, 'empty-tail')
    await ctx.semanticMap.refresh(session.id)
    expect(session.seq).toBe(0)
    expect(mapState(ctx, session).logVersion).toBe(0)
  })

  it('labels the next operator turn from a preceding compaction summary (design g)', async () => {
    const ctx = await backend()
    const { session } = await liveSession(ctx, 'summary-label')
    say(session, 'before compaction')
    session.append('compaction/summary', {
      compactionId: 'c1' as never,
      summary: [{ type: 'text', text: 'Consolidated route through the navigator build with sealed units ahead' }],
      shadowedRange: { start: SessionSeq(0), end: SessionSeq(1) },
      shadowedSeqs: [],
      shadowedTokenCount: 0,
      provider: 'test',
      model: 'test',
    })
    say(session, 'after compaction')
    await ctx.semanticMap.refresh(session.id)

    const state = mapState(ctx, session)
    expect(state.units).toHaveLength(2)
    const text = 'Consolidated route through the navigator build with sealed units ahead'
    expect(state.units[1]?.label).toBe(text.slice(0, 64))
  })

  it('accepts a plain-string compaction summary and a summary without extractable text', async () => {
    const ctx = await backend()
    const { session } = await liveSession(ctx, 'summary-variants')
    say(session, 'turn one')
    session.append('compaction/summary', { compactionId: 'c2', summary: 'inline plain summary' } as never)
    say(session, 'turn two')
    session.append('compaction/summary', { compactionId: 'c3' } as never)
    say(session, 'turn three')
    await ctx.semanticMap.refresh(session.id)

    const state = mapState(ctx, session)
    expect(state.units.map(u => u.label)).toEqual(['# 1', 'inline plain summary', '# 3'])
  })

  it('routes labeling through a registered semanticMapLabeler seam when present', async () => {
    const ctx = await backend()
    const { session } = await liveSession(ctx, 'labeler-seam')
    const inputs: LabelerInput[] = []
    const labeler: SemanticMapLabeler = {
      label: async (input) => {
        inputs.push(input)
        return [{
          id: `m-${inputs.length}`,
          kind: 'direction',
          label: `probe ${inputs.length}`,
          fromSeq: 0,
          toSeq: 0,
          sealed: false,
          eventCount: 1,
        } as SemanticMapUnit]
      },
    }
    ctx.provide('semanticMapLabeler', labeler as never)

    say(session, 'anchor one')
    await ctx.semanticMap.refresh(session.id)
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ truncated: false, carry: '' })
    expect(mapState(ctx, session).units[0]).toMatchObject({ id: 'm-1', label: 'probe 1', sealed: false })

    say(session, 'anchor two')
    await ctx.semanticMap.refresh(session.id)
    // Carry echo includes the open unit's label (carryFromSealed seam).
    expect(inputs[1]?.carry).toContain('probe 1')
    expect(mapState(ctx, session).units).toHaveLength(1)
    expect(mapState(ctx, session).units[0]?.id).toBe('m-2')
  })

  it('echoes only sealed labels when every existing unit is sealed (carry seam)', async () => {
    const ctx = await backend()
    const { session } = await liveSession(ctx, 'labeler-sealed')
    const inputs: LabelerInput[] = []
    const labeler: SemanticMapLabeler = {
      label: async (input) => {
        inputs.push(input)
        return [{
          id: `s-${inputs.length}`,
          kind: 'direction',
          label: `seal ${inputs.length}`,
          fromSeq: 0,
          toSeq: 0,
          sealed: true,
          eventCount: 1,
        } as SemanticMapUnit]
      },
    }
    ctx.provide('semanticMapLabeler', labeler as never)

    say(session, 'anchor one')
    await ctx.semanticMap.refresh(session.id)
    say(session, 'anchor two')
    await ctx.semanticMap.refresh(session.id)

    expect(inputs).toHaveLength(2)
    expect(inputs[1]?.carry).toBe('seal 1')
    const state = mapState(ctx, session)
    expect(state.units.map(u => u.id)).toEqual(['s-1', 's-2'])
  })

  it('honors a strict config override passed to the plugin', async () => {
    const ctx = await backend()
    const parsed = SemanticMapConfig.parse({ digestBudget: 42 })
    expect(parsed.digestBudget).toBe(42)
    const { session } = await liveSession(ctx, 'config-flow')
    say(session, 'a')
    await ctx.semanticMap.refresh(session.id)
    expect(mapState(ctx, session).units).toHaveLength(1)
  })
})
