/**
 * Internal mirror of the `session/semantic-map` payload: the fold consumes
 * exactly the snapshot shape the refresh service appends (TC-004 fixes the
 * real log declaration). Mirrored as a local alias — instead of reaching
 * into the event map — so this card compiles standalone; the declaration in
 * `./types.ts` and this mirror must stay structurally identical.
 *
 * @module @deepseek-ai/dsh-session-semantic-map/events
 */

import type { SemanticMapState } from './types.ts'

/** One sidecar snapshot carried by a `session/semantic-map` log event. */
export type SemanticMapEventData = SemanticMapState
