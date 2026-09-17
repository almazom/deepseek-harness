/**
 * Types for the model-backed Smart-steer queue advisor: one advisory side
 * run over a read-only conversation snapshot, its session-log events, and
 * the deployment policy. Host runtime code stays out of this module.
 * @module @deepseek-ai/dsh-session-advisor-llm/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** One distinct advisory side run attached to one queued-message decision. */
export type AdvisorRunId = Branded<'advisorRun'>

/** Fixed cognitive phases of one advisory run, completed in this order. */
export type AdvisorStepId = 'tail' | 'compare' | 'risk' | 'verdict'

/** Exact model-visible request recorded before one advisory side dispatch. */
export interface AdvisorRunRequestedEventData {
  /** Queued message the advisory run decides about. */
  readonly queuedItemId: MessageId
  /** Exact human `user/message` seqs represented in `messages`. */
  readonly messageSeqs: SessionSeq[]
  /** Exact advisory system prompt (the run rubric). */
  readonly system: string
  /** Exact advisory message list (the read-only snapshot). */
  readonly messages: Message[]
  /** Exact advisory output-token cap. */
  readonly maxTokens: number
}

/** One completed advisory phase with its real finding text. */
export interface AdvisorStepEventData {
  /** Advisory run this phase belongs to. */
  readonly runId: AdvisorRunId
  /** Which fixed cognitive phase completed. */
  readonly step: AdvisorStepId
  /** The model's finding for this phase, verbatim. */
  readonly finding: string
}

/** Final advisory decision applied against the Smart-steer confidence gate. */
export interface AdvisorVerdictEventData {
  /** Advisory run this verdict belongs to. */
  readonly runId: AdvisorRunId
  /** Gate outcome: send now, or hold the queued message. */
  readonly kind: 'send-now' | 'hold'
  /** Model-reported confidence, clamped to [0, 1]. */
  readonly confidence: number
  /** Configured `smartSteerMinConfidence` the verdict was compared against. */
  readonly gateThreshold: number
  /** One-sentence verdict rationale quoted from the model output. */
  readonly reason: string
}

/** Required deployment policy for the model-backed advisor run. */
export interface AdvisorLlmConfig {
  /** Maximum UTF-8 bytes in the JSON-framed advisory user prompt. */
  readonly maxInputBytes: number
  /** Advisory generation output-token cap. */
  readonly maxOutputTokens: number
  /** End-to-end advisory request deadline in milliseconds. */
  readonly timeoutMs: number
  /** Optional explicit provider route; must be paired with `model`. */
  readonly provider?: string
  /** Optional explicit model id; must be paired with `provider`. */
  readonly model?: string
}

/** Validated immutable advisor-run policy. */
export interface ResolvedAdvisorLlmConfig extends AdvisorLlmConfig {}
