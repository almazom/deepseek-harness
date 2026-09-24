/**
 * Function plugin registering the `semanticMap` projection unit: the
 * session's semantic route (operator-anchored direction points) served
 * through the session-projection seam — registry snapshot, change feed, and
 * every projection carrier — so the sidebar navigator renders the map
 * without holding the event log. This entry also owns the manual refresh
 * service (`ctx.semanticMap.refresh`): a watermark-guarded tail scan through
 * the sanctioned async persistence read, folded back into the seam as a
 * `session/semantic-map` sidecar append.
 *
 * @module @deepseek-ai/dsh-session-semantic-map
 */

import type { Context } from '@deepseek-ai/cordis'
import { semanticMapProjectionDefinition } from './projection.ts'
import { SemanticMapConfig, type SemanticMapConfigInput } from './config.ts'
import { refreshSemanticMap } from './service.ts'

export type * from './types.ts'
export { SemanticMapConfig as Config } from './config.ts'
export type { SemanticMapConfigInput as ConfigInput } from './config.ts'

/** Cordis plugin name. */
export const name = 'session-semantic-map'
/**
 * The projection registry is the plugin's whole purpose; `sessions` carries
 * the live-store lookups and the durability flush the refresh scan needs.
 */
export const inject = ['sessionProjections', 'sessions']

/**
 * Register the `semanticMap` unit and expose the manual refresh service.
 * The plugin's `Config` is the strict zod schema (standard-schema compatible,
 * so the Loader validates cordis.yml input through the same path).
 * @param ctx - registrant context carrying the projection registry.
 * @param config - strict semantic-map configuration (all defaults apply).
 */
export function apply(ctx: Context, config: SemanticMapConfigInput = {}): void {
  const parsed = SemanticMapConfig.parse(config ?? {})
  ctx.sessionProjections.register(semanticMapProjectionDefinition)
  ctx.provide('semanticMap', {
    refresh: (sessionId: string) => refreshSemanticMap(ctx, sessionId, parsed),
  })
}
