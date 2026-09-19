// @vitest-environment jsdom
/** Deterministic tier-1 advisor brain: verdict classification from session snapshot facts. */
import { describe, expect, it } from 'vitest'
import {
  ADVISOR_PIPELINE_STEP_IDS, advise, gateOutcome, runAdvisorPipeline,
} from '../src/client/advisor.ts'

describe('tier-1 advisor verdicts', () => {
  const base = { running: true, queuedCount: 1 }

  it('classifies a short English interrogative row as a status probe', () => {
    expect(advise({ ...base, rowText: 'what is happening now?' })).toEqual({
      kind: 'status', reasonKey: 'advisor.verdict.status',
    })
  })

  it('classifies a short Russian probe as a status question', () => {
    expect(advise({ ...base, rowText: '  что происходит?  ' })).toEqual({
      kind: 'status', reasonKey: 'advisor.verdict.status',
    })
  })

  it('defers a short row that is not a question', () => {
    expect(advise({ ...base, rowText: 'fix the login bug' })).toEqual({
      kind: 'defer', reasonKey: 'advisor.verdict.defer',
    })
  })

  it('defers a question without any probe token', () => {
    expect(advise({ ...base, rowText: 'use vitest instead?' })).toEqual({
      kind: 'defer', reasonKey: 'advisor.verdict.defer',
    })
  })

  it('defers a probe question over the length cap', () => {
    expect(advise({ ...base, rowText: `${'a'.repeat(75)} what?` })).toEqual({
      kind: 'defer', reasonKey: 'advisor.verdict.defer',
    })
  })

  it('classifies a status probe exactly at the length cap', () => {
    expect(advise({ ...base, rowText: `${'a'.repeat(74)} what?` })).toEqual({
      kind: 'status', reasonKey: 'advisor.verdict.status',
    })
  })

  it('defers an attachment-only row without text', () => {
    expect(advise({ ...base, rowText: '' })).toEqual({
      kind: 'defer', reasonKey: 'advisor.verdict.defer',
    })
  })
})

describe('advisor pipeline and confidence gate', () => {
  const base = { running: true, queuedCount: 1 }

  it('completes every phase in order with findings and a high-confidence status verdict', () => {
    const result = runAdvisorPipeline({ ...base, rowText: 'что происходит?' }, 0.95)
    expect(result.steps.map(step => step.id)).toEqual([...ADVISOR_PIPELINE_STEP_IDS])
    expect(result.steps.map(step => step.status)).toEqual(['done', 'done', 'done', 'done'])
    expect(result.outcome).toMatchObject({ kind: 'status', confidence: 0.97 })
    expect(result.steps.map(step => step.detail.key)).toEqual([
      'advisor.detail.sessionRunning', 'advisor.detail.probeMatched',
      'advisor.detail.interruptRisk', 'advisor.detail.gateAllowed',
    ])
    expect(result.steps[3]?.detail).toMatchObject({ params: { p: 97 } })
  })

  it('keeps the defer verdict below the default gate with its reasoning chain', () => {
    const result = runAdvisorPipeline({ ...base, rowText: 'fix the login bug' }, 0.95)
    expect(result.outcome.kind).toBe('defer')
    expect(result.outcome.confidence).toBe(0.7)
    expect(result.steps.map(step => step.detail.key)).toEqual([
      'advisor.detail.sessionRunning', 'advisor.detail.instructionDetected',
      'advisor.detail.boundaryDelivery', 'advisor.detail.gateHeld',
    ])
  })

  it('reports the idle session fact and honors a raised gate', () => {
    const result = runAdvisorPipeline({ running: false, queuedCount: 2, rowText: 'what?' }, 0.99)
    expect(result.steps[0]?.detail).toMatchObject({ key: 'advisor.detail.sessionIdle', params: { n: 2 } })
    expect(gateOutcome(result.outcome, 0.99)).toBe('held')
    expect(result.steps[3]?.detail).toMatchObject({ key: 'advisor.detail.gateHeld', params: { p: 97 } })
  })

  it('gates a confidence at or above the threshold as allowed', () => {
    const result = runAdvisorPipeline({ ...base, rowText: 'status?' }, 0.95)
    expect(gateOutcome(result.outcome, 0.95)).toBe('allowed')
  })

  it('gates a confidence below the threshold as held', () => {
    const result = runAdvisorPipeline({ ...base, rowText: 'fix the login bug' }, 0.95)
    expect(gateOutcome(result.outcome, 0.95)).toBe('held')
  })

  it('gates exactly at the configured minimum as allowed', () => {
    expect(gateOutcome({ kind: 'status', reasonKey: 'advisor.verdict.status', confidence: 0.9 }, 0.9)).toBe('allowed')
  })
})
