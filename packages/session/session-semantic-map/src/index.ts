/**
 * Function plugin registering the `semanticMap` projection unit: the
 * session's semantic route (operator-anchored direction points) served
 * through the session-projection seam — registry snapshot, change feed, and
 * every projection carrier — so the sidebar navigator renders the map
 * without holding the event log. The plugin owns only the fold; delivery is
 * the seam's. Later cards layer the manual refresh service and the Remote
 * namespace onto this entry.
 *
 * @module @deepseek-ai/dsh-session-semantic-map
 */

import type { Context } from '@deepseek-ai/cordis'
import { semanticMapProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'session-semantic-map'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `semanticMap` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(semanticMapProjectionDefinition)
}
