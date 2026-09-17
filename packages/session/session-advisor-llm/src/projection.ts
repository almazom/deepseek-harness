/**
 * The `advisor/run` projection unit: folds the advisory side-run session
 * events into the whole-run client value. Host runtime only.
 * @module @deepseek-ai/dsh-session-advisor-llm/projection
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ProjectionDefinition, SessionProjectionMap } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { AdvisorRunId, AdvisorRunProjection, AdvisorRunStep, AdvisorRunVerdict } from './types.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'advisor/run': AdvisorRunProjection | null
  }
}

const advisorStepSchema = z.object({
  step: z.enum(['tail', 'compare', 'risk', 'verdict']),
  finding: z.string(),
})

const advisorVerdictSchema = z.object({
  kind: z.enum(['send-now', 'hold']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
})

/** Validates persisted fold state; `verdict` is absent until the run settles. */
export const advisorRunStateSchema = z.object({
  runId: z.custom<AdvisorRunId>(value => typeof value === 'string'),
  queuedItemId: z.custom<MessageId>(value => typeof value === 'string'),
  status: z.enum(['running', 'done', 'failed']),
  steps: z.array(advisorStepSchema).readonly(),
  verdict: advisorVerdictSchema.optional(),
})

const advisorRunWireSchema = advisorRunStateSchema.nullable()

/**
 * One advisory run per session: the newest `advisor/run-requested` starts a
 * fresh value and every matching `advisor/step`, `advisor/verdict`, or
 * `advisor/failed` event mutates only that run. The run id is the branded seq
 * of its request event, so the fold is deterministic over the log.
 */
export const advisorRunProjectionDefinition = {
  key: 'advisor/run',
  stateVersion: 1,
  stateSchema: advisorRunStateSchema.nullable(),
  init: (_header: SessionHeader, _inheritedEventCount: SessionLogOffset): AdvisorRunProjection | null => null,
  apply: (state: AdvisorRunProjection | null, event: SessionEvent): AdvisorRunProjection | null => {
    switch (event.type) {
      case 'advisor/run-requested':
        return {
          runId: brandString<AdvisorRunId>(String(event.seq)),
          queuedItemId: event.data.queuedItemId,
          status: 'running',
          steps: [],
        }
      case 'advisor/step':
        if (state === null || state.runId !== event.data.runId || state.status !== 'running') return state
        if (state.steps.some(landing => landing.step === event.data.step)) return state
        const steps: AdvisorRunStep[] = [...state.steps, { step: event.data.step, finding: event.data.finding }]
        return { ...state, steps }
      case 'advisor/verdict': {
        if (state === null || state.runId !== event.data.runId || state.status !== 'running') return state
        const verdict: AdvisorRunVerdict = {
          kind: event.data.kind,
          confidence: event.data.confidence,
          reason: event.data.reason,
        }
        return { ...state, status: 'done', verdict }
      }
      case 'advisor/failed':
        if (state === null || state.runId !== event.data.runId || state.status !== 'running') return state
        return { ...state, status: 'failed' }
      default:
        return state
    }
  },
  wire: {
    viewSchema: advisorRunWireSchema,
    view: (state: AdvisorRunProjection | null): SessionProjectionMap['advisor/run'] => state,
  },
} satisfies ProjectionDefinition<'advisor/run', AdvisorRunProjection | null>
