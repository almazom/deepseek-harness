/**
 * Pure types of the semantic-map domain: the ONE home of the `semanticMap`
 * projection-key declaration and the `session/semantic-map` sidecar event
 * vocabulary, free of this package's host-side value imports (zod, the
 * projection definition). Host consumers import `./types`; client
 * aggregates import `./client`, which re-exports this module.
 *
 * @module @deepseek-ai/dsh-session-semantic-map/types
 */

import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

export {}

/** How a unit anchors the session's direction: a stop, a sub-stop, or a continuation slot. */
export type SemanticMapUnitKind = 'direction' | 'substop' | 'continuation'

/**
 * One semantic unit of the session map — an operator-anchored direction point
 * (many-to-one merge of operator inputs) ordered strictly by `fromSeq`.
 * Sealed units are immutable: a later refresh may re-cut only the open tail.
 */
export interface SemanticMapUnit {
  /** Stable identity across refreshes (kind + fromSeq); sealed ids keep their label forever. */
  readonly id: string
  /** Anchor role rendered by the route strip (◆ direction, ◦ sub-stop, ◆↻ continuation). */
  readonly kind: SemanticMapUnitKind
  /** Label of at most four words (LLM output clipped, or deterministic fallback). */
  readonly label: string
  /** First event seq covered by this unit — the transcript jump target. */
  readonly fromSeq: SessionSeq
  /** Last event seq covered by this unit (inclusive). */
  readonly toSeq: SessionSeq
  /** True once a later refresh must not re-cut this unit's label. */
  readonly sealed: boolean
  /** Event span length, rendered as segment height ∝ work volume. */
  readonly eventCount: number
}

/**
 * Sidecar snapshot: the sealed units, the open tail's start, the watermark
 * (last seq a refresh processed), the sidecar's log version, and the wall
 * clock of the last refresh. This shape is BOTH the projection fold state
 * and the payload of the `session/semantic-map` event the refresh service
 * appends — the fold consumes exactly what the service logs (model-visible
 * ⟺ logged stays intact because the service never mutates state off-log).
 */
export interface SemanticMapState {
  /** Units in ascending `fromSeq` order; all but the last are sealed. */
  readonly units: readonly SemanticMapUnit[]
  /** First event seq of the open (unsealed) tail; null until the first refresh. */
  readonly openTailSeq: SessionSeq | null
  /** Last event seq a refresh processed (null = never refreshed); drives the client's stale count. */
  readonly watermark: SessionSeq | null
  /** Sidecar version stamped by the service at each append. */
  readonly logVersion: number
  /** Epoch-ms timestamp of the last refresh append (0 = never). */
  readonly updatedAt: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Semantic-map sidecar fold state (see {@link SemanticMapState}). */
    semanticMap: SemanticMapState
  }
  interface SessionProjectionMap {
    /** Units of the semantic route, ascending by `fromSeq`; the wire view the client strip renders. */
    semanticMap: readonly SemanticMapUnit[]
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** A refresh's sidecar snapshot, appended as the seam event the fold consumes. */
    'session/semantic-map': SemanticMapState
  }
}

/**
 * The manual refresh service this plugin installs as `ctx.semanticMap` —
 * operator-button driven only (no auto-refresh anywhere).
 */
export interface SemanticMapService {
  /**
   * Re-scan the session tail after the projection watermark and append the
   * refreshed `session/semantic-map` payload. Idempotent: an empty tail is a
   * no-op that leaves `logVersion` untouched.
   * @param sessionId - the live session to refresh.
   */
  refresh(sessionId: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Manual semantic-map refresh service (this plugin's `apply` installs it). */
    semanticMap: SemanticMapService
  }
}
