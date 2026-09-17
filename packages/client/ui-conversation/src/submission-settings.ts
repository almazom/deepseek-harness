/** Busy-Enter preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Field carrying the minimum Smart-steer pipeline confidence that allows delivery. */
export const SMART_STEER_MIN_CONFIDENCE_FIELD = 'smartSteerMinConfidence'

/** Default gate: a pipeline verdict below this confidence defaults to KEEP QUEUED. */
export const DEFAULT_SMART_STEER_MIN_CONFIDENCE = 0.95

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /** Minimum Smart-steer pipeline confidence that counts as an allowed delivery. */
  smartSteerMinConfidence: number
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [SMART_STEER_MIN_CONFIDENCE_FIELD]: z
    .number()
    .min(0.5)
    .max(1)
    .default(DEFAULT_SMART_STEER_MIN_CONFIDENCE),
})
