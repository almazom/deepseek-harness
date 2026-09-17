/** Deterministic tier-1 Smart-steer advisor: verdicts from session snapshot facts only. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ConversationNode } from '../contract/records.ts'

/** Locale key of the operator-facing verdict sentence rendered by the advisor sheet. */
export type AdvisorReasonKey = 'advisor.verdict.defer' | 'advisor.verdict.status'

/** One deterministic advisor outcome for one queued row. */
export interface AdvisorVerdict {
  /**
   * `status` answers the operator from the sheet's snapshot without any delivery;
   * `defer` keeps the row queued for delivery at the next step boundary.
   * The LLM tier (future work) may widen this union; tier 1 never steers on its own.
   */
  readonly kind: 'status' | 'defer'
  readonly reasonKey: AdvisorReasonKey
}

/** Snapshot facts the tier-1 advisor reads; no transcript, goal, or model access. */
export interface AdvisorInput {
  /** Whether the addressed agent is mid-turn right now. */
  readonly running: boolean
  /** How many rows share the queue with the advised one. */
  readonly queuedCount: number
  /** The advised row's text content; empty for attachment-only rows. */
  readonly rowText: string
}

/** Interrogative tokens (EN + RU) that mark a row as a status probe. Explicit
 * anchors instead of \b, whose ASCII word edges never match Cyrillic. */
const STATUS_PROBE_TOKENS =
  'what|why|how|when|where|which|who|status|progress|готово|как|какой|когда|где|почему|прогресс|статус|что'
const STATUS_PROBE = new RegExp(`(?:^|[\\s¿¡])(?:${STATUS_PROBE_TOKENS})(?=$|[\\s?!,.:;])`, 'i')

/** Status probes are short questions; anything longer carries real instructions. */
const MAX_PROBE_LENGTH = 80

/**
 * Classify one queued row with the deterministic tier-1 rules.
 * @param input - snapshot facts about the session and the advised row.
 * @returns `status` for short interrogative probes the snapshot itself answers,
 * `defer` for everything that reads as a real instruction.
 */
export function advise(input: AdvisorInput): AdvisorVerdict {
  const text = input.rowText.trim()
  const short = text.length > 0 && text.length <= MAX_PROBE_LENGTH
  if (short && text.endsWith('?') && STATUS_PROBE.test(text)) {
    return { kind: 'status', reasonKey: 'advisor.verdict.status' }
  }
  return { kind: 'defer', reasonKey: 'advisor.verdict.defer' }
}

/** Identifiers of the sequential advisor pipeline phases, in execution order. */
export const ADVISOR_STEP_IDS = ['session-status', 'input-analysis', 'risk-assessment', 'verdict'] as const

/** One advisor pipeline phase identifier. */
export type AdvisorStepId = typeof ADVISOR_STEP_IDS[number]

/** Lifecycle of one pipeline phase row in the advisor sheet. */
export type AdvisorStepStatus = 'pending' | 'running' | 'done' | 'failed'

/** One rendered pipeline phase: its identity plus where it currently stands. */
export interface AdvisorStep {
  readonly id: AdvisorStepId
  readonly status: AdvisorStepStatus
}

/** Verdict paired with the tier-1 heuristic confidence behind it. */
export interface AdvisorOutcome extends AdvisorVerdict {
  /**
   * Tier-1 heuristic confidence in [0, 1] — a rule-match score, not a
   * probability. Compared against the configured `smartSteerMinConfidence`
   * gate: at or above the gate the pipeline marks the row deliverable,
   * below it the sheet defaults to KEEP QUEUED with the reasons shown.
   */
  readonly confidence: number
}

/** Confidence the tier-1 rules assign a recognized status probe. */
const STATUS_PROBE_CONFIDENCE = 0.97

/** Confidence the tier-1 rules assign everything else (never crosses the gate). */
const DEFER_CONFIDENCE = 0.7

/**
 * Result of one full pipeline run: every phase completed plus the gated
 * outcome. The pure run never leaves a phase `failed` — that state exists
 * for the future LLM tier's error paths.
 */
export interface AdvisorPipelineResult {
  readonly steps: readonly AdvisorStep[]
  readonly outcome: AdvisorOutcome
}

/**
 * Run the full tier-1 pipeline synchronously: snapshot facts in, one outcome
 * out. The caller owns revealing the returned phases over time; the sheet
 * renders them as live rows.
 * @param input - snapshot facts about the session and the advised row.
 * @returns all four phases `done` and the confidence-tagged verdict.
 */
export function runAdvisorPipeline(input: AdvisorInput): AdvisorPipelineResult {
  const steps = ADVISOR_STEP_IDS.map(id => ({ id, status: 'done' as const }))
  const verdict = advise(input)
  return {
    steps,
    outcome: {
      ...verdict,
      confidence: verdict.kind === 'status' ? STATUS_PROBE_CONFIDENCE : DEFER_CONFIDENCE,
    },
  }
}

/**
 * Apply the confidence gate to one pipeline outcome.
 * @param outcome - the pipeline's verdict with its tier-1 confidence.
 * @param minConfidence - the configured gate in [0.5, 1].
 * @returns `allowed` when the confidence reaches the gate, otherwise `held`.
 */
export function gateOutcome(
  outcome: AdvisorOutcome,
  minConfidence: number,
): 'allowed' | 'held' {
  return outcome.confidence >= minConfidence ? 'allowed' : 'held'
}

/**
 * Newest human-visible transcript preview (user or steering node), oldest-first scan
 * from the tail. Attachment-only or empty messages are skipped in favor of the next
 * older one.
 * @param nodes - the chat target's legacy conversation nodes in ascending seq order.
 * @returns the newest human text preview, or undefined before any human input.
 */
export function lastHumanPreview(nodes: readonly ConversationNode[]): string | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node === undefined || (node.kind !== 'user' && node.kind !== 'steering')) continue
    const preview = textPreview(node.content)
    if (preview !== undefined) return preview
  }
  return undefined
}

/** Whitespace-collapsed concatenation of the blocks' text; undefined without any text. */
function textPreview(content: readonly ContentBlock[]): string | undefined {
  const text = content
    .map(block => block.type === 'text' ? block.text : '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? undefined : text
}
