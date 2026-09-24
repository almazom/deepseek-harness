/**
 * The `semanticMap` projection unit: a pure fold of `session/semantic-map`
 * sidecar snapshots into the state the client's route strip renders. The
 * service appends one snapshot per manual refresh; the fold keeps the event
 * log the single source of truth (no off-log state) and enforces the spec's
 * stability invariants: the watermark only ever advances, a `sealed: true`
 * unit keeps its stored label forever (a refresh may re-cut only the open
 * tail and append new units), and `logVersion`/`updatedAt` ride the snapshot
 * itself — append gating (when a digest actually changed) is the refresh
 * service's job (TC-003).
 *
 * @module @deepseek-ai/dsh-session-semantic-map/projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SemanticMapEventData } from './events.ts'
import type { SemanticMapState, SemanticMapUnit } from './types.ts'

const semanticMapUnitSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['direction', 'substop', 'continuation']),
  label: z.string().max(64),
  fromSeq: z.number().int().nonnegative().transform(SessionSeq),
  toSeq: z.number().int().nonnegative().transform(SessionSeq),
  sealed: z.boolean(),
  eventCount: z.number().int().nonnegative(),
}).strict()

const semanticMapUnitsSchema: ZodType<readonly SemanticMapUnit[]> = z.array(semanticMapUnitSchema)
  .superRefine((units, context) => {
    let previous = -1
    for (const unit of units) {
      if (unit.fromSeq <= previous) {
        context.addIssue({ code: 'custom', message: 'semantic map units must be strictly increasing by fromSeq' })
        return
      }
      previous = unit.fromSeq
    }
  })

const semanticMapStateSchema: ZodType<SemanticMapState> = z.object({
  units: semanticMapUnitsSchema,
  openTailSeq: z.number().int().nonnegative().transform(SessionSeq).nullable(),
  watermark: z.number().int().nonnegative().transform(SessionSeq).nullable(),
  logVersion: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict()

const EMPTY_MAP: SemanticMapState = {
  units: [],
  openTailSeq: null,
  watermark: null,
  logVersion: 0,
  updatedAt: 0,
}

/** The `semanticMap` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const semanticMapProjectionDefinition = {
  key: 'semanticMap',
  // v2: the invariant fold (sealed labels, monotone watermark) replaced the
  // scaffold's wholesale replace-on-append semantics.
  stateVersion: 2,
  stateSchema: semanticMapStateSchema,
  init: () => EMPTY_MAP,
  apply: (state, event) => {
    if (event.type !== 'session/semantic-map') return state
    // The incoming list is the refresh's view of the map: start from it, but
    // every unit this state already sealed keeps its stored identity — only
    // the open tail and newly added units may carry new labels.
    const data: SemanticMapEventData = event.data
    const next: SemanticMapUnit[] = [...data.units]
    for (const kept of state.units) {
      if (!kept.sealed) continue
      const index = next.findIndex(unit => unit.id === kept.id)
      const incoming = index === -1 ? undefined : next[index]
      if (incoming && incoming.label !== kept.label) next[index] = kept
    }
    const watermark = data.watermark === null
      ? state.watermark
      : state.watermark === null || data.watermark > state.watermark
        ? data.watermark
        : state.watermark
    return {
      units: next,
      openTailSeq: data.openTailSeq,
      watermark,
      logVersion: data.logVersion,
      updatedAt: data.updatedAt,
    }
  },
  wire: {
    viewSchema: semanticMapUnitsSchema,
    view: state => state.units,
  },
} satisfies ProjectionDefinition<'semanticMap', SemanticMapState>
