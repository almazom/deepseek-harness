/**
 * Deterministic no-provider fallback builder (spec § Incremental update
 * algorithm): when no LLM provider is configured, each operator turn window
 * becomes a `direction` unit labeled from its compaction summary title, or
 * `# N` order label when no title covers it. Pure and side-effect free, so
 * the refresh service can rebuild the whole map from the transcript alone.
 *
 * @module @deepseek-ai/dsh-session-semantic-map/fallback
 */

import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { SemanticMapUnit } from './types.ts'

/**
 * Build direction units for user-turn windows.
 * @param userTurnSeqs - Event seqs of operator (human) turns, ascending.
 * @param summaryLabels - Compaction summary titles keyed by turn seq.
 * @returns One unit per turn; all but the last window start sealed.
 */
export function fallbackUnits(
  userTurnSeqs: readonly number[],
  summaryLabels: ReadonlyMap<number, string>,
): SemanticMapUnit[] {
  return userTurnSeqs.map<SemanticMapUnit>((seq, i) => {
    const next = userTurnSeqs[i + 1] ?? seq
    return {
      id: `d-${seq}`,
      kind: 'direction',
      label: summaryLabels.get(seq) ?? `# ${i + 1}`,
      fromSeq: SessionSeq(seq),
      toSeq: SessionSeq(next),
      sealed: i < userTurnSeqs.length - 1,
      eventCount: 1,
    }
  })
}
