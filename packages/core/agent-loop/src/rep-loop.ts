/**
 * Repetition-loop guard for the compaction placeholder (lever C, bc-p0-closeout * TC-007).
 *
 * The placeholder literal appears throughout fleet session history but had NO
 * definition site anywhere in rc.2 at card-writing time (whole-tree ripgrep:
 * zero non-comment hits), so this module is the single definition: card AC
 * "one constant definition, no duplicate literal" is satisfied by construction.
 */

/** The compaction placeholder the model echoes when it loses tool results. */
export const COMPACTION_PLACEHOLDER = '[tool results were replaced by compact summaries to save context]'

/** Echoes required before the guard trips: 3 consecutive (or 3 copies in one message). */
export const REP_LOOP_LIMIT = 3

/** Non-overlapping occurrences of the placeholder inside `text`. */
export function placeholderCopies(text: string): number {
  let copies = 0
  let index = text.indexOf(COMPACTION_PLACEHOLDER)
  while (index !== -1) {
    copies += 1
    index = text.indexOf(COMPACTION_PLACEHOLDER, index + COMPACTION_PLACEHOLDER.length)
  }
  return copies
}

/** True when `text` is exactly the placeholder (trimmed) or contains at least REP_LOOP_LIMIT copies. */
export function isPlaceholderEcho(text: string): boolean {
  if (text.trim() === COMPACTION_PLACEHOLDER) return true
  return placeholderCopies(text) >= REP_LOOP_LIMIT
}

export type RepLoopMessage = { role: string; content: string }

/**
 * Walk back over consecutive assistant messages; true once REP_LOOP_LIMIT
 * echoes meet, or a single message carries REP_LOOP_LIMIT copies.
 */
export function detectRepLoop(msgs: RepLoopMessage[]): boolean {
  let run = 0
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const message = msgs[i]
    if (message === undefined) break
    if (message.role !== 'assistant') break
    if (placeholderCopies(message.content) >= REP_LOOP_LIMIT) return true
    if (isPlaceholderEcho(message.content)) {
      run += 1
      if (run >= REP_LOOP_LIMIT) return true
    } else {
      break
    }
  }
  return false
}
