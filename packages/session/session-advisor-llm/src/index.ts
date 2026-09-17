/**
 * Shared framing, section-streaming, timeout, and validation policy for the
 * model-backed Smart-steer queue advisor: one advisory side run over a
 * read-only conversation snapshot whose phases stream into the session log
 * as they complete. The run never touches the main agent loop; explicit
 * user action is the only bridge from an advisory verdict back to the queue.
 * @module @deepseek-ai/dsh-session-advisor-llm
 */

import type {} from '@deepseek-ai/dsh-session-projection/types'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import z from '@deepseek-ai/schemastery'
import type {
  AdvisorLlmConfig,
  AdvisorStepId,
  ResolvedAdvisorLlmConfig,
} from './types.ts'

export type {
  AdvisorLlmConfig,
  AdvisorRunId,
  AdvisorRunProjection,
  AdvisorRunRequestedEventData,
  AdvisorRunStep,
  AdvisorRunVerdict,
  AdvisorStepEventData,
  AdvisorStepId,
  AdvisorVerdictEventData,
  ResolvedAdvisorLlmConfig,
} from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one advisory side run. */
    'advisor/run-requested': import('./types.ts').AdvisorRunRequestedEventData
    /** One advisory cognitive phase completed with its real finding. */
    'advisor/step': import('./types.ts').AdvisorStepEventData
    /** Final advisory decision against the Smart-steer confidence gate. */
    'advisor/verdict': import('./types.ts').AdvisorVerdictEventData
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Live advisory side run for one queued message, whole value per step. */
    'advisor/run': import('./types.ts').AdvisorRunProjection
  }
}

/** Fixed advisory phase order; the model contract emits sections in it. */
export const ADVISOR_STEP_IDS: readonly AdvisorStepId[] = deepFreeze([
  'tail',
  'compare',
  'risk',
  'verdict',
])

/** Capability-owned timeout reason code for one advisory side run. */
export const ADVISOR_RUN_TIMEOUT_CODE = 'ADVISOR_RUN_TIMEOUT'

/** Complete configuration key set for direct construction validation. */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'maxInputBytes',
  'maxOutputTokens',
  'timeoutMs',
  'provider',
  'model',
])

/** Shared Loader field schemas with no library defaults. */
export const AdvisorLlmConfigFields = {
  maxInputBytes: z.number().step(1).min(1).required(),
  maxOutputTokens: z.number().step(1).min(1).required(),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
  provider: z.string(),
  model: z.string(),
}

/** Shared Loader schema with no library defaults. */
export const AdvisorLlmConfigSchema: z<AdvisorLlmConfig> = z.object(AdvisorLlmConfigFields)

/** Validate one positive integer limit. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-advisor-llm: ${name} must be a positive integer`)
  }
}

/**
 * Validate and detach required advisor-run configuration.
 * @param config - untrusted plugin configuration.
 * @returns immutable policy with optional route absence preserved.
 */
export function resolveAdvisorLlmConfig(config: AdvisorLlmConfig): ResolvedAdvisorLlmConfig {
  const candidate: unknown = config
  if (candidate === null || typeof candidate !== 'object') {
    throw new Error('session-advisor-llm: configuration is required')
  }
  const value = candidate as AdvisorLlmConfig
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`session-advisor-llm: unknown config key "${key}"`)
  }
  assertPositiveInteger('maxInputBytes', value.maxInputBytes)
  assertPositiveInteger('maxOutputTokens', value.maxOutputTokens)
  assertPositiveInteger('timeoutMs', value.timeoutMs)
  if (value.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`session-advisor-llm: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  if ((value.provider === undefined) !== (value.model === undefined)) {
    throw new Error('session-advisor-llm: provider and model must be paired')
  }
  return deepFreeze({ ...value })
}

/** Read-only conversation snapshot framed into one advisory user prompt. */
export interface AdvisorPromptInput {
  /** The queued message the run decides about, verbatim. */
  readonly queuedMessage: string
  /** Conversation tail, oldest first, ending at the present moment. */
  readonly tail: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[]
  /** Recent distinct user requests, oldest first. */
  readonly recentRequests: readonly string[]
  /** Configured input cap applied to the complete framed JSON. */
  readonly maxInputBytes: number
}

/**
 * Frame one advisory request: the fixed JSON section contract in the system
 * prompt, the snapshot as one JSON user message. The byte cap applies to the
 * complete framed user message; the oldest tail entries are dropped first
 * and failure to fit even the queued message rejects the run.
 * @param input - advisory snapshot plus the configured input cap.
 * @returns model-visible message list for one advisory dispatch.
 */
export function buildAdvisorMessages(input: AdvisorPromptInput): readonly Message[] {
  const queued = JSON.stringify({ queuedMessage: input.queuedMessage })
  const byteLength = (value: string): number => Buffer.byteLength(value, 'utf8')
  if (byteLength(queued) > input.maxInputBytes) {
    throw new Error('session-advisor-llm: queued message exceeds maxInputBytes')
  }
  const tail = [...input.tail]
  let framed = ''
  for (;;) {
    framed = JSON.stringify({
      queuedMessage: input.queuedMessage,
      tail,
      recentRequests: input.recentRequests,
    })
    if (byteLength(framed) <= input.maxInputBytes) break
    if (tail.length === 0) throw new Error('session-advisor-llm: snapshot exceeds maxInputBytes')
    tail.shift()
  }
  return [createUserMessage({
    content: [{ type: 'text', text: framed }],
    source: { kind: 'plugin', plugin: 'dsh-session-advisor-llm' },
  })]
}

/**
 * The fixed advisory system prompt: the run rubric and the JSON section
 * contract, keyed `tail`, `compare`, `risk`, `verdict` in emission order.
 * Model-visible text is pinned verbatim; do not reword without a snapshot.
 * @returns exact advisory system prompt.
 */
export function buildAdvisorSystemPrompt(): string {
  return [
    'You are the Smart-steer queue advisor. A queued user message is waiting',
    'while an agent turn is running. Decide whether sending it now is safe,',
    'using only the JSON snapshot provided. Emit exactly one JSON object with',
    'the keys "tail", "compare", "risk", "verdict" in that order and no other',
    'top-level keys. Values: {"finding": string} for "tail", "compare", and',
    '"risk"; {"kind": "send-now" | "hold", "confidence": number in [0,1],',
    '"reason": string} for "verdict". The "finding" of each key must quote',
    'the concrete evidence: "tail" names what the conversation tail is doing',
    'right now; "compare" states how the queued message relates to the',
    'system-level task and the recent user requests, or contradicts them;',
    '"risk" states what breaks if the queued message interrupts now. The',
    'verdict is "send-now" only when interruption loses nothing and',
    'confidence is at least the configured gate; otherwise "hold". Write',
    'findings in English, one sentence each.',
  ].join(' ')
}

/** One completed top-level section of the advisory output stream. */
export interface AdvisorSection {
  /** Top-level JSON key whose value just closed. */
  readonly key: string
  /** Exact raw JSON text of the key's value, ready for JSON.parse. */
  readonly raw: string
}

/**
 * Incremental watcher over the advisory output stream. Fed text deltas, it
 * reports each top-level key the moment its value closes, so advisory
 * phases land in the session log while the model is still emitting — the
 * stream, not a timer, paces the visible steps. Malformed JSON surfaces at
 * {@link AdvisorSectionWatcher.finish}, never as thrown deltas.
 */
export class AdvisorSectionWatcher {
  #buffer = ''
  #depth = 0
  #inString = false
  #escape = false
  /** Index right after the current top-level key's colon, or -1 when none is open. */
  #sectionStart = -1
  /** Index right after the separator that started the current top-level key. */
  #keyStart = -1
  /** Position of the current top-level key's colon, or -1 when none was seen. */
  #colonAt = -1
  #emitted: string[] = []
  #pending: AdvisorSection[] = []

  /**
   * Feed one text delta and collect sections closed by it. Any top-level
   * key is emitted in closure order; mapping keys to the fixed advisory
   * phases and dropping unknown keys is the runner's job.
   * @param delta - exact text chunk from the advisory output stream.
   * @returns sections closed by this delta, in closure order.
   */
  push(delta: string): readonly AdvisorSection[] {
    for (let i = 0; i < delta.length; i += 1) {
      const char = delta[i]
      this.#buffer += char
      if (this.#inString) {
        if (this.#escape) this.#escape = false
        else if (char === '\\') this.#escape = true
        else if (char === '"') this.#inString = false
        continue
      }
      if (char === '"') {
        this.#inString = true
        continue
      }
      if (char === '{' || char === '[') {
        if (this.#depth === 0) this.#keyStart = this.#buffer.length
        this.#depth += 1
      } else if (char === '}' || char === ']') {
        this.#depth -= 1
      } else if (char === ':' && this.#depth === 1 && this.#sectionStart < 0) {
        this.#sectionStart = this.#buffer.length
        this.#colonAt = this.#buffer.length - 1
      } else if (char === ',' && this.#depth === 1) {
        this.#keyStart = this.#buffer.length
      }
      const closedAtTop =
        (char === '}' || char === ']') && this.#depth === 1 && this.#sectionStart >= 0
      const closedAtRoot = char === '}' && this.#depth === 0 && this.#sectionStart >= 0
      if (closedAtTop || closedAtRoot) this.#pending.push(this.#closeSection(closedAtTop))
    }
    const closed = this.#pending
    this.#pending = []
    return closed
  }

  /**
   * Extract and record one closed top-level section from the buffer. The
   * closing character belongs to the value when the section closed one
   * nesting level above it; only the root brace is excluded.
   */
  #closeSection(includeClose: boolean): AdvisorSection {
    const end = includeClose ? this.#buffer.length : this.#buffer.length - 1
    const raw = this.#buffer.slice(this.#sectionStart, end).trim()
    const key = this.#buffer
      .slice(this.#keyStart, this.#colonAt)
      .trim()
      .replace(/^"(.*)"$/s, '$1')
    this.#sectionStart = -1
    this.#colonAt = -1
    this.#emitted.push(key)
    return { key, raw }
  }

  /**
   * Report stream health after the final delta.
   * @returns top-level keys emitted so far and whether the JSON object closed.
   */
  finish(): { readonly keys: readonly string[]; readonly closed: boolean } {
    return { keys: [...this.#emitted], closed: !this.#inString && this.#depth === 0 }
  }
}
