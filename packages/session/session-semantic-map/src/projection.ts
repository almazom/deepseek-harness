/**
 * The `semanticMap` projection unit: a pure fold of `session/semantic-map`
 * sidecar snapshots into the state the client's route strip renders. The
 * service appends one snapshot per manual refresh; the fold keeps the event
 * log the single source of truth (no off-log state), and TC-002 layers the
 * seal/watermark invariants on top of this scaffold's replace-on-append core.
 *
 * @module @deepseek-ai/dsh-session-semantic-map/projection
 */

import { z } from 'zod'
import type { ZodType } from 'zod'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
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
  stateVersion: 1,
  stateSchema: semanticMapStateSchema,
  init: () => EMPTY_MAP,
  apply: (state, event) => {
    // Scaffold core: each sidecar snapshot replaces the state wholesale;
    // TC-002 tightens this to "sealed units immutable, watermark monotone".
    if (event.type !== 'session/semantic-map') return state
    return event.data
  },
  wire: {
    viewSchema: semanticMapUnitsSchema,
    view: state => state.units,
  },
} satisfies ProjectionDefinition<'semanticMap', SemanticMapState>
