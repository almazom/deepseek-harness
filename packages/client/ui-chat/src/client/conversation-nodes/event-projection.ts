/** Chat-owned conversion from durable Session events to Chat view data. */

import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm/types'
import type {
  AssistantBlock, ContextProvenanceView, KnownContextForm,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Single home of the `hook/invoked` / `hook/result` SessionEventMap members is
// hook-protocol (the origin of the shapes); this type-only load pulls that
// augmentation into the program — no value reaches the client bundle.
import type {} from '@deepseek-ai/dsh-hook-protocol'

/* jscpd:ignore-start -- Chat and Trajectory own independent event-to-view projections. */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function collect(source: Record<string, unknown>, member: string, field: string): string[] {
  const list = source[member]
  if (!Array.isArray(list)) return []
  const seen: string[] = []
  for (const entry of list) {
    const record = asRecord(entry)
    const value = record === null ? null : readString(record, field)
    if (value !== null && !seen.includes(value)) seen.push(value)
  }
  return seen
}

function joined(names: string[]): string | null {
  return names.length > 0 ? names.join(', ') : null
}

/** Forms Chat presents structurally; unknown merge-extensible values remain opaque. */
const KNOWN_FORMS: readonly KnownContextForm[] = [
  'instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall',
]

/**
 * Read the target-supported presentation form from a durable message source.
 * @param source - Logged `user/message` source.
 * @returns Supported form, or null for the opaque presentation.
 */
export function contextForm(source: unknown): KnownContextForm | null {
  const record = asRecord(source)
  const form = record === null ? null : readString(record, 'form')
  return form !== null && (KNOWN_FORMS as readonly string[]).includes(form)
    ? form as KnownContextForm
    : null
}

/**
 * Project a durable message source to the Chat row's role and producer label.
 * @param source - Logged `user/message` source.
 * @returns Role and label rendered by Chat.
 */
export function contextProvenance(source: unknown): ContextProvenanceView {
  const record = asRecord(source)
  const kind = record === null ? null : readString(record, 'kind')
  if (record === null || kind === null) return { role: 'inject', label: null }
  switch (kind) {
    case 'session-reference':
      return { role: 'recall', label: joined(collect(record, 'references', 'label')) ?? kind }
    case 'agent-instructions':
      return { role: 'inject', label: joined(collect(record, 'changes', 'path')) ?? kind }
    case 'plugin':
      return { role: 'inject', label: readString(record, 'plugin') ?? kind }
    case 'skill-invocation':
      return { role: 'inject', label: readString(record, 'name') ?? kind }
    default:
      // MessageSourceMap is merge-extensible; keep an unknown producer
      // visible by its durable kind.
      return { role: 'inject', label: kind }
  }
}

/**
 * Read distinct labels cited by a durable cross-session recall source.
 * @param source - Logged `user/message` source.
 * @returns Labels in first-seen order.
 */
export function sessionRecallLabels(source: unknown): string[] {
  const record = asRecord(source)
  if (record === null || readString(record, 'kind') !== 'session-reference') return []
  return collect(record, 'references', 'label')
}

/**
 * Read the skill name a durable skill-invocation injection loaded.
 * @param source - Logged `user/message` source.
 * @returns The skill name, or null for every other source.
 */
export function skillInvocationName(source: unknown): string | null {
  const record = asRecord(source)
  if (record === null || readString(record, 'kind') !== 'skill-invocation') return null
  return readString(record, 'name')
}

/**
 * Classify finalized Assistant content for Chat rendering.
 * @param content - Core content blocks.
 * @returns Chat blocks in source order.
 */
export function toAssistantBlocks(content: readonly ContentBlock[]): AssistantBlock[] {
  return content.map(toAssistantBlock)
}

/**
 * Classify one finalized Assistant block for Chat rendering.
 * @param block - Core content block.
 * @returns Chat block.
 */
export function toAssistantBlock(block: ContentBlock): AssistantBlock {
  switch (block.type) {
    case 'text': return { kind: 'text', text: block.text }
    case 'reasoning': return { kind: 'reasoning', text: block.text }
    case 'image': return { kind: 'image', attachment: block.attachment }
    case 'tool-call': return { kind: 'tool-call', callId: String(block.id), name: block.name, argsRaw: block.arguments }
    default: return { kind: 'other', block }
  }
}

/**
 * Create the initial Chat block for one streamed Assistant block kind.
 * @param blockType - Wire block kind.
 * @returns Empty block ready to receive deltas.
 */
export function emptyAssistantBlock(blockType: string): AssistantBlock {
  switch (blockType) {
    case 'text': return { kind: 'text', text: '' }
    case 'reasoning': return { kind: 'reasoning', text: '' }
    case 'tool-call': return { kind: 'tool-call', callId: '', name: '', argsRaw: '' }
    default: return { kind: 'other', block: null }
  }
}

/** Display-safe failure fields retained by Chat projections. */
export interface DisplayFailure {
  readonly code?: string
  readonly message: string
}

/**
 * Convert a durable failure to locale-independent fields safe for Chat.
 * @param failure - Failure preserved by a Session event.
 * @returns Sanitized message and optional stable provider code.
 */
export function displayFailure(failure: unknown): DisplayFailure {
  if (failure === null || typeof failure !== 'object') return { message: String(failure) }
  const record = failure as { code?: unknown; message?: unknown }
  const code = typeof record.code === 'string' ? record.code : undefined
  // Provider AUTH messages may echo a masked or partially preserved credential.
  // Keep the raw diagnostic in the Session log, but never retain it in UI state.
  if (code === 'AUTH') return { code, message: '' }
  return {
    ...(code === undefined ? {} : { code }),
    message: typeof record.message === 'string' ? record.message : JSON.stringify(failure),
  }
}

/**
 * Whether a stream chunk carries visible model output for Chat timing.
 * @param chunk - Stream chunk to inspect.
 * @returns true for a non-empty text, reasoning, or Tool-call delta.
 */
export function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}

/* jscpd:ignore-end */

/** One projected hook run on the Chat hooks card. */
export interface HookRunView {
  /** Durable hook point, e.g. `PreToolUse`. */
  readonly point: string
  /** Handler identity that served the invocation. */
  readonly handlerId: string
  /** Wire dialect of the invocation, when recorded. */
  readonly dialect?: string
  /** Matcher expression that routed the invocation, when recorded. */
  readonly matcher?: string
  /** Parsed decision, defaulting to `stop`/`pass`; absent while still running. */
  readonly decision?: string
  /** Handler process exit code, when recorded. */
  readonly exitCode?: number
  /** Measured handler wall duration, recorded by the paired result. */
  readonly durationMs?: number
}

/** Durable `hook/invoked` payload fields consumed by the projection. */
export type HookInvokedData = {
  readonly point: string
  readonly handlerId: string
  readonly dialect: string
} & { readonly matcher?: string }

/** Durable `hook/result` payload fields consumed by the projection. */
export interface HookResultData {
  readonly point: string
  readonly handlerId: string
  readonly decision: string
  readonly exitCode?: number
  readonly durationMs: number
}

/**
 * Project one durable `hook/invoked` payload to a pending hooks-card row.
 * @param data - Logged `hook/invoked` payload.
 * @returns The run row awaiting its paired result.
 */
export function hookRunOfInvoked(data: HookInvokedData): HookRunView {
  return {
    point: data.point,
    handlerId: data.handlerId,
    dialect: data.dialect,
    ...(data.matcher === undefined ? {} : { matcher: data.matcher }),
  }
}

/**
 * Apply one durable `hook/result` payload to the projected runs of its turn.
 * The result payload names no invocation id, so it completes the latest still-open
 * run with the same point and handler — the log orders invoked before result. The
 * protocol invariant permits concurrent open runs of one point+handler key; this
 * pairing then attributes the result to the latest of them (accepted heuristic).
 * @param runs - Runs projected so far for the turn.
 * @param data - Logged `hook/result` payload.
 * @returns Replacement run list with the paired run completed.
 */
export function applyHookResult(
  runs: readonly HookRunView[],
  data: HookResultData,
): HookRunView[] {
  let paired = -1
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index]
    if (run !== undefined && run.point === data.point && run.handlerId === data.handlerId && run.decision === undefined) {
      paired = index
      break
    }
  }
  if (paired < 0) return [...runs]
  return runs.map((run, index) => index === paired
    ? {
      ...run,
      decision: data.decision,
      ...(data.exitCode === undefined ? {} : { exitCode: data.exitCode }),
      durationMs: data.durationMs,
    }
    : run)
}
