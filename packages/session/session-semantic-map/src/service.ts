import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { SemanticMapConfig } from './config.ts'
import type { SemanticMapState, SemanticMapUnit } from './types.ts'
import { digestLine, extractText, type DigestLine } from './digest.ts'
import { labelWithChunks, type SemanticMapLabeler } from './label.ts'
import { fallbackUnits } from './fallback.ts'

const EMPTY_STATE: SemanticMapState = {
  units: [],
  openTailSeq: null,
  watermark: null,
  logVersion: 0,
  updatedAt: 0,
}

/**
 * Refresh the semantic map for `sessionId`.
 *
 * Tail events are read through the sanctioned async path (durability flush +
 * persistence windowed read) — never a new synchronous Session history read,
 * which the 2026-09-09 deprecation policy prohibits for new production calls.
 * The refresh appends a `session/semantic-map` sidecar payload, so every unit
 * the fold ever sees is a logged event (model-visible ⟺ logged stays intact).
 *
 * @param ctx - plugin context carrying `sessions`, `sessionProjections`, and
 *   optionally `sessionPersistence` / `semanticMapLabeler`.
 * @param sessionId - live session to refresh.
 * @param config - parsed strict configuration.
 * @throws when the session is not open, persistence is absent, or the tail
 *   cannot be read durably.
 */
export async function refreshSemanticMap(
  ctx: Context,
  sessionId: string,
  config: SemanticMapConfig,
): Promise<void> {
  const session = ctx.sessions.get(SessionId(sessionId))
  if (!session) {
    throw new Error(`semantic map: session "${sessionId}" is not open in this store`)
  }

  const persistence = ctx.get('sessionPersistence')
  if (!persistence) {
    throw new Error('semantic map: refresh requires the sessionPersistence service')
  }

  const state = ctx.sessionProjections.stateOf(session, 'semanticMap') ?? EMPTY_STATE

  // AC2: idempotent no-op when nothing landed after the watermark. Our own
  // sidecar occupies seq watermark + 1, so "only it followed" means the next
  // seq is at most watermark + 2.
  if (state.watermark !== null && session.seq <= state.watermark + 2) return

  // Re-process the open region so the fallback rebuild stays contiguous with
  // the last sealed unit; the sealed prefix is never re-read.
  const reprocessFrom = state.units.at(-1)?.fromSeq
  const tailStart = reprocessFrom ?? (state.watermark === null ? 0 : state.watermark + 1)

  // Durability barrier: pending live events must reach storage before the
  // read handle observes them.
  await ctx.sessions.flush(session)

  const handle = await persistence.open(sessionId, 'read')
  let tail: readonly SessionEvent[]
  try {
    const page = await handle.read(tailStart, undefined)
    tail = page.events
  } finally {
    await handle.close()
  }
  if (tail.length === 0) return

  const lines: DigestLine[] = []
  for (const event of tail) {
    const line = digestLine(event)
    if (line) lines.push(line)
  }

  const labeler = ctx.get('semanticMapLabeler') as SemanticMapLabeler | undefined
  let newTailUnits: SemanticMapUnit[]
  if (labeler) {
    newTailUnits = await labelWithChunks(
      labeler,
      { lines, carry: carryFromSealed(state, config) },
      config,
    )
  } else {
    // AC4: no labeler registered (TC-003 era) — deterministic fallback, and
    // the payload is still appended so the projection stays fresh.
    newTailUnits = fallbackUnits(tailUserSeqs(tail), summaryLabels(tail))
  }

  // Revision cap: ALL sealed units are kept untouched (0 re-cut, ≤1 allowed);
  // only the open tail is rebuilt by the new units.
  const keptSealed = state.units.filter(unit => unit.sealed)
  const units = newTailUnits.length > 0 ? [...keptSealed, ...newTailUnits] : state.units
  const lastSeq = tail.at(-1)?.seq
  if (lastSeq === undefined) return

  const payload: SemanticMapState = {
    units,
    openTailSeq: lastSeq,
    watermark: lastSeq,
    logVersion: state.logVersion + 1,
    updatedAt: Date.now(),
  }
  session.append('session/semantic-map', payload)
}

function tailUserSeqs(tail: readonly SessionEvent[]): number[] {
  return tail.filter(event => event.type === 'user/message').map(event => event.seq)
}

/**
 * Summary labels keyed to the first user turn after the summary event:
 * `compaction/summary` carries `summary: ContentBlock[]` (there is no title
 * field), and `fallbackUnits` looks labels up by user-turn seq.
 */
function summaryLabels(tail: readonly SessionEvent[]): Map<number, string> {
  const labels = new Map<number, string>()
  let pending: string | null = null
  for (const event of tail) {
    if (String(event.type) === 'compaction/summary') {
      const data = (event as { data?: { summary?: unknown } }).data
      const text = extractText(data?.summary)
      if (text) pending = text.slice(0, 64)
      continue
    }
    if (pending && event.type === 'user/message') {
      labels.set(event.seq, pending)
      pending = null
    }
  }
  return labels
}

/**
 * Carry echo for the labeler: labels of the last three sealed units plus the
 * open unit's label, clipped to `carryEchoTokens * 4` chars.
 */
function carryFromSealed(state: SemanticMapState, config: SemanticMapConfig): string {
  const sealed = state.units.filter(unit => unit.sealed).slice(-3)
  const open = state.units.at(-1)
  const parts = open && !open.sealed ? [...sealed, open.label] : sealed.map(unit => unit.label)
  return parts.join('\n').slice(0, config.carryEchoTokens * 4)
}
