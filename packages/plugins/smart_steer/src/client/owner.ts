/**
 * The dock-slot contract the smart_steer plugin owns: the SlotMap entry and
 * the owner share the queue dock hands the advisor surface. Declaring them
 * here keeps the whole advisor client surface inside the plugin — ui-conversation
 * references this package's client face, never the reverse.
 */

// Loads the client session kit members (useSession, useProjection) the slot owner share merges.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

/**
 * Raw facts and callbacks the queue dock hands the advisor surface; the surface
 * computes the tier-1 pipeline from them and renders the sheet and peek pill.
 */
export interface AdvisorOwnerProps {
  /** Whether an anchor is being advised; false renders nothing. */
  open: boolean
  /** Whether the sheet is collapsed into the peek pill. */
  peek: boolean
  /** Settled advisory answers for the advised anchor, counting the initial run. */
  peekAnswers: number
  /** Whether the addressed agent is mid-turn. */
  running: boolean
  /** How many rows share the queue with the advised one. */
  queuedCount: number
  /** Whether another queue mutation is in flight; disables the override action. */
  busy: boolean
  /** The advised anchor's text preview; empty without an anchor. */
  rowPreview: string
  /** True for a /side fallback run: no pending row backs the anchor. */
  rowless: boolean
  /** The advised anchor's queue-item id; undefined for a rowless run. */
  anchorId: string | undefined
  /** Newest human transcript preview; undefined before any human input. */
  lastHuman: string | undefined
  /** The configured confidence gate in [0.5, 1]. */
  minConfidence: number
  /**
   * The in-sheet follow-up composer; each submission starts a fresh advisory
   * run without touching the main conversation. Absent for a rowless run,
   * which owns no row.
   */
  followUp: { readonly disabled: boolean; readonly onSubmit: (question: string) => void } | undefined
  /** Delivers the advised row now; absent for a rowless run, which owns no row. */
  onSendNow: (() => void) | undefined
  /** Collapses the sheet into the peek pill; the side run keeps streaming. */
  onCollapse: () => void
  /** Expands the peek pill back into the sheet. */
  onExpand: () => void
  /** Closes the sheet or pill and dismisses the current run. */
  onClose: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The advisor surface anchored to the input dock: a `single` session slot
     * the smart_steer plugin registers into. Absent without it: the queue dock
     * renders no advisor and its smart button still opens the run for the
     * projected answer, but no sheet appears to read or act on it.
     */
    'conversation.input.dock.advisor': {
      kind: 'single'
      scope: 'session'
      owner: AdvisorOwnerProps
    }
  }
}
