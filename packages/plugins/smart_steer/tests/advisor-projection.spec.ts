import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { advisorRunProjectionDefinition } from '../src/advisor-projection.ts'
import type { AdvisorRunProjection } from '../src/types.ts'

const QUEUED = MessageId('queued-1')

function requestedEvent(seq: number): SessionEvent {
  return {
    type: 'advisor/run-requested',
    seq,
    data: {
      queuedItemId: QUEUED,
      messageSeqs: [],
      system: 'system prompt',
      messages: [],
      maxTokens: 512,
    },
  } as unknown as SessionEvent
}

function stepEvent(seq: number, runId: string, step: 'tail' | 'compare' | 'risk' | 'verdict', finding: string): SessionEvent {
  return { type: 'advisor/step', seq, data: { runId, step, finding } } as unknown as SessionEvent
}

function verdictEvent(seq: number, runId: string): SessionEvent {
  return {
    type: 'advisor/verdict',
    seq,
    data: { runId, kind: 'hold', confidence: 0.97, reason: 'Mid-edit.' },
  } as unknown as SessionEvent
}

function failedEvent(seq: number, runId: string): SessionEvent {
  return { type: 'advisor/failed', seq, data: { runId, reason: 'stream died' } } as unknown as SessionEvent
}

const HEADER = { id: 'advisor-fold', seq: 0 } as never

describe('advisor/run projection fold', () => {
  it('starts at null before any advisory run', () => {
    expect(advisorRunProjectionDefinition.init(HEADER, SessionLogOffset(0))).toBeNull()
  })

  it('opens a running run keyed by the request event seq', () => {
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    const opened = advisorRunProjectionDefinition.apply(null, requestedEvent(7))
    expect(opened).toMatchObject({
      runId: brandString<AdvisorRunProjection['runId']>('7'),
      queuedItemId: QUEUED,
      status: 'running',
      steps: [],
    })
  })

  it('appends matching steps in order and deduplicates a replayed step', () => {
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    const opened = advisorRunProjectionDefinition.apply(null, requestedEvent(7))
    let state = advisorRunProjectionDefinition.apply(opened, stepEvent(8, '7', 'tail', 'One'))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    state = advisorRunProjectionDefinition.apply(state, stepEvent(9, '7', 'risk', 'Two'))
    expect(state).toMatchObject({ status: 'running', steps: [
      { step: 'tail', finding: 'One' },
      { step: 'risk', finding: 'Two' },
    ] })
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    const replayed = advisorRunProjectionDefinition.apply(state, stepEvent(10, '7', 'tail', 'One'))
    expect(replayed).toBe(state)
  })

  it('settles with the verdict and ignores later steps from the same run', () => {
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    let state = advisorRunProjectionDefinition.apply(null, requestedEvent(7))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    state = advisorRunProjectionDefinition.apply(state, stepEvent(8, '7', 'tail', 'One'))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    state = advisorRunProjectionDefinition.apply(state, verdictEvent(11, '7'))
    expect(state).toMatchObject({ status: 'done', verdict: { kind: 'hold', confidence: 0.97, reason: 'Mid-edit.' } })
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    const after = advisorRunProjectionDefinition.apply(state, stepEvent(12, '7', 'risk', 'Late'))
    expect(after).toBe(state)
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    const reVerdict = advisorRunProjectionDefinition.apply(state, verdictEvent(13, '7'))
    expect(reVerdict).toBe(state)
  })

  it('ignores steps and a second verdict after the run failed', () => {
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    let state = advisorRunProjectionDefinition.apply(null, requestedEvent(7))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    state = advisorRunProjectionDefinition.apply(state, failedEvent(8, '7'))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    state = advisorRunProjectionDefinition.apply(state, stepEvent(9, '7', 'tail', 'Late'))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    state = advisorRunProjectionDefinition.apply(state, verdictEvent(10, '7'))
    expect(state).toMatchObject({ status: 'failed', steps: [] })
    expect(state?.verdict).toBeUndefined()
  })

  it('records a failure instead of a verdict', () => {
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    let state = advisorRunProjectionDefinition.apply(null, requestedEvent(7))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    state = advisorRunProjectionDefinition.apply(state, failedEvent(12, '7'))
    expect(state).toMatchObject({ status: 'failed' })
    expect(state?.verdict).toBeUndefined()
  })

  it('ignores events for other runs and uninterested types, keeping the same reference', () => {
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    const state = advisorRunProjectionDefinition.apply(null, requestedEvent(7))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    const other = advisorRunProjectionDefinition.apply(state, stepEvent(8, '9', 'tail', 'Foreign'))
    expect(other).toBe(state)
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    const same = advisorRunProjectionDefinition.apply(state, { type: 'turn/start', seq: 9, data: { turn: 1 } } as unknown as SessionEvent)
    expect(same).toBe(state)
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    const failedOther = advisorRunProjectionDefinition.apply(state, failedEvent(13, '9'))
    expect(failedOther).toBe(state)
  })

  it('round-trips its persisted state through the state schema', () => {
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    let state = advisorRunProjectionDefinition.apply(null, requestedEvent(7))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    state = advisorRunProjectionDefinition.apply(state, stepEvent(8, '7', 'tail', 'One'))
    // oxlint-disable-next-line eslint/prefer-spread -- domain fold method, not Function.prototype.apply
    state = advisorRunProjectionDefinition.apply(state, verdictEvent(11, '7'))
    expect(advisorRunProjectionDefinition.stateSchema.parse(state)).toEqual(state)
    expect(advisorRunProjectionDefinition.wire.view(state)).toBe(state)
  })
})
