import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector, createSessionFormatCatalog } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatHeader, SessionFormatMigrationStageInput, SessionFormatEventRun } from '@deepseek-ai/dsh-session-format'
import { releasedV0SessionFormatCodec, sessionFormatV0ToV1 } from '@deepseek-ai/dsh-session-format-v0-to-v1'
import { releasedV1SessionFormatCodec, sessionFormatV1ToV2 } from '@deepseek-ai/dsh-session-format-v1-to-v2'
import { releasedV2SessionFormatCodec, sessionFormatV2ToV3 } from '@deepseek-ai/dsh-session-format-v2-to-v3'
import { assertReleasedV4Header, releasedV3SessionFormatCodec, releasedV4SessionFormatCodec, restoreReleasedV4Artifact, sessionFormatV3ToV4 } from '../src/index.ts'

const v3Header = (origin?: 'subagent' | 'headless', isSeeded = false): SessionFormatHeader =>
  ({ version: 3, id: 'identity', createdAt: 1, cwd: '/tmp/project', isSeeded, ...(origin === undefined ? {} : { origin }), delegationDepth: 0, agentPreset: 'ptc' })

const event = (type: string, data: SessionFormatEvent['data'], surfaceOp?: SessionFormatEvent['surfaceOp']): SessionFormatEvent =>
  ({ type, seq: 0, time: 42, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) })

const dense = (events: readonly SessionFormatEvent[]) => events.map((e, seq) => ({ ...e, seq }))

function stage(source = v3Header(), sourceCut?: number) {
  const target = sessionFormatV3ToV4.migrateHeader(source)
  const input: SessionFormatMigrationStageInput = {
    sourceHeader: source,
    targetHeader: target,
    sourceInheritedEventCount: sourceCut,
    sourceKind: 'decoded',
  }
  return { source, target, value: sessionFormatV3ToV4.createStage(input), collector: new SessionFormatEventCollector() }
}

function migrate(events: readonly SessionFormatEvent[], source = v3Header(), cut: number | undefined = 0): SessionFormatEvent[] {
  const h = stage(source, cut)
  for (const e of dense(events)) h.value.transformEvent(e, h.collector)
  expect(h.value.finish(h.collector)).toBe(cut)
  return h.collector.values
}

function run(events: readonly SessionFormatEvent[]): SessionFormatEventRun {
  return { runType: 'test/compact', firstSeq: events[0]!.seq, eventCount: events.length, expand: () => events }
}

const catalog = createSessionFormatCatalog({
  currentVersion: 4,
  codecs: [
    releasedV0SessionFormatCodec, releasedV1SessionFormatCodec, releasedV2SessionFormatCodec,
    releasedV3SessionFormatCodec, releasedV4SessionFormatCodec,
  ],
  currentEncoder: releasedV4SessionFormatCodec,
  migrations: [sessionFormatV0ToV1, sessionFormatV1ToV2, sessionFormatV2ToV3, sessionFormatV3ToV4],
  restoreCurrent: artifact => restoreReleasedV4Artifact(artifact, new Set()),
  restoreTransformedCurrent: artifact => restoreReleasedV4Artifact(artifact, new Set()),
  restoreCurrentHeader(value) { assertReleasedV4Header(value); return value },
})

describe('V3-to-V4 identity migration', () => {
  it('passes events through unchanged and stamps the target header version', () => {
    const input = dense([
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      event('user/message', { role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }, 'append'),
      event('request/header', { header: { config: { provider: 'mock', model: 'mock' } }, reason: 'initial' }),
      event('turn/end', { turn: 1, reason: { kind: 'complete' } }),
    ])
    const output = migrate(input, v3Header('subagent'))
    expect(output).toEqual(input)
    expect(output.map(e => e.seq)).toEqual([0, 1, 2, 3, 4])
  })

  it('migrates a seeded v3 header and keeps its cut at the source position', () => {
    const h = stage(v3Header(undefined, true), 2)
    for (const e of dense([event('user/message', { role: 'user', id: 'u', source: { kind: 'user' }, content: [] }), event('turn/start', { turn: 1 }), event('session/end-seed', { inherited: true })])) {
      h.value.transformEvent(e, h.collector)
    }
    expect(h.value.finish(h.collector)).toBe(2)
    expect(h.collector.values).toHaveLength(3)
    expect(h.target).toEqual({ ...v3Header(undefined, true), version: 4 })
  })

  it('expands compact runs through the identity path', () => {
    const h = stage()
    h.value.transformRun(run(dense([event('turn/start', { turn: 1 }), event('step/start', { turn: 1, step: 1 })])), h.collector)
    expect(h.collector.values.map(e => e.type)).toEqual(['turn/start', 'step/start'])
    expect(h.value.finish(h.collector)).toBe(0)
  })

  it('refuses sparse sources and cross-generation delivery markers', () => {
    const h = stage()
    expect(() => { h.value.transformEvent({ ...event('turn/start', { turn: 1 }), seq: 3 }, h.collector) }).toThrow(/dense/)
    const claim = stage()
    expect(() => { claim.value.transformEvent(event('session-log-deepseek/delivery-accepted', { sessionFormatVersion: 4, sessionId: 'identity' }), claim.collector) })
      .toThrow(/claims target format v4/)
    const foreign = stage(v3Header(), 0)
    foreign.value.transformEvent({ ...event('session-log-deepseek/delivery-accepted', { sessionFormatVersion: 3, sessionId: 'other' }), seq: 0 }, foreign.collector)
    expect(() => { foreign.value.finish(foreign.collector) }).toThrow(/delivery marker names the wrong Session/)
  })

  it('refuses inherited markers on unseeded sources and disagrees with the provided cut', () => {
    const unseeded = stage()
    expect(() => { unseeded.value.transformEvent(event('session/end-seed', { inherited: true }), unseeded.collector) })
      .toThrow(/unseeded Session contains an inherited end-seed marker/)
    const mismatch = stage(v3Header(), 5)
    expect(() => { mismatch.value.finish(mismatch.collector) }).toThrow(/disagrees with its source cut/)
  })

  it('refuses a v3 header with the headless origin as migration source', () => {
    expect(() => { sessionFormatV3ToV4.migrateHeader(v3Header('headless')) }).toThrow(/origin must be "subagent"/)
  })
})

describe('released V4 codec', () => {
  it('round-trips headers with subagent, headless, and absent origins', () => {
    for (const origin of [undefined, 'subagent', 'headless'] as const) {
      const source = { ...v3Header(origin), version: 4 }
      const physical = releasedV4SessionFormatCodec.encodeHeader(source, 0)
      expect(releasedV4SessionFormatCodec.decodeHeader(physical)).toEqual(source)
      expect(physical).toMatchObject({ type: 'session', version: 4, ...(origin === undefined ? {} : { origin }) })
    }
  })

  it('refuses v4 headers with an unknown origin and rejects v3 physical headers', () => {
    expect(() => { releasedV4SessionFormatCodec.decodeHeader({ type: 'session', version: 4, id: 'i', createdAt: 1, isSeeded: false, delegationDepth: 0, origin: 'worker' }) })
      .toThrow(/origin must be "subagent" or "headless"/)
    expect(() => { releasedV4SessionFormatCodec.decodeHeader({ type: 'session', version: 3, id: 'i', createdAt: 1, isSeeded: false, delegationDepth: 0 }) })
      .toThrow(/expected released v4 physical Session header/)
    expect(() => { assertReleasedV4Header({ ...v3Header(), version: 4, extra: true }) })
      .toThrow(/unexpected field/)
    expect(() => { assertReleasedV4Header({ ...v3Header(), version: 4, cwd: 'relative/path' }) })
      .toThrow(/cwd must be absolute/)
    expect(() => { assertReleasedV4Header(v3Header()) })
      .toThrow(/expected format v4 header/)
  })

  it('refuses an inherited cut on an unseeded encode', () => {
    expect(() => { releasedV4SessionFormatCodec.encodeHeader({ ...v3Header(), version: 4 }, 3) })
      .toThrow(/unseeded format v4 Session has inherited events/)
  })

  it('delegates source-event range encoding to the released-v3 codec', () => {
    const source = dense([event('turn/start', { turn: 1 }), { ...event('user/message', { role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }, 'append'), sourceEventSeqs: [0] }])
    expect(releasedV4SessionFormatCodec.encodeEvent(source[1]!)).toEqual(releasedV3SessionFormatCodec.encodeEvent(source[1]!))
  })
})

describe('catalog assembly with the V4 edge', () => {
  it('restores a v4 artifact with a headless origin through the strict target validator', () => {
    const artifact = {
      header: { ...v3Header('headless'), version: 4 },
      inheritedEventCount: 0,
      events: dense([event('turn/start', { turn: 1 }), event('turn/end', { turn: 1, reason: { kind: 'complete' } })]),
    }
    expect(restoreReleasedV4Artifact(artifact, new Set())).toBe(artifact)
    expect(catalog.currentVersion).toBe(4)
  })

  it('rejects an invalid headless artifact before relationships run', () => {
    const artifact = {
      header: { ...v3Header('headless'), version: 4, cwd: 'nope' },
      inheritedEventCount: 0,
      events: [],
    }
    expect(() => { restoreReleasedV4Artifact(artifact, new Set()) }).toThrow(/cwd must be absolute/)
  })
})
