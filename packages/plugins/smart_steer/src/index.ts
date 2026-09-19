/**
 * Isolated Smart-steer plugin: one Cordis plugin owning the whole advisory
 * surface between the user and the system — the model-backed queue advisor
 * dispatcher, the `/side` (`/btw`) command, and both session projections
 * (`advisor/run`, `smart_steer/latest-human`). Mounts without advisor config
 * register the command surface only; the dispatcher service exists only when
 * the mount supplies an explicit provider/model route.
 * @module @deepseek-ai/dsh-smart-steer
 */

import type { Context } from '@deepseek-ai/cordis'
import QueueAdvisorService from './dispatcher.ts'
import { applySideCommand } from './side-command.ts'
import type { AdvisorLlmConfig } from './types.ts'

export type {
  AdvisorFailedEventData,
  AdvisorLlmConfig,
  AdvisorRunId,
  AdvisorRunProjection,
  AdvisorRunRequestedEventData,
  AdvisorRunStep,
  AdvisorRunVerdict,
  AdvisorStepEventData,
  AdvisorStepId,
  AdvisorVerdictEventData,
  ResolvedAdvisorLlmConfig,
} from './types.ts'

export {
  ADVISOR_RUN_TIMEOUT_CODE,
  ADVISOR_STEP_IDS,
  AdvisorLlmConfigFields,
  buildAdvisorMessages,
  buildAdvisorSystemPrompt,
  resolveAdvisorLlmConfig,
} from './config.ts'
export type { AdvisorPromptInput } from './config.ts'
export { advisorRunProjectionDefinition } from './advisor-projection.ts'
export type { LatestHumanMessage } from './latest-human.ts'
export { latestHumanProjectionDefinition, messageText } from './latest-human.ts'
export type { QueueAdvisorRequest } from './dispatcher.ts'

/** Cordis plugin name of the isolated Smart-steer plugin. */
export const name = 'smart_steer'

/** Services required to register the command surface and projection. */
export const inject = ['commands', 'sessionProjections']

/**
 * Mount the Smart-steer surface: register `/side` (`/btw`) plus the
 * latest-human projection, and construct the advisory dispatcher only for
 * mounts that carry an explicit provider/model route. Mount config passes to
 * the service class, whose required-field schema fails loud on an incomplete
 * policy.
 * @param ctx - Cordis context owning the registrations and the service.
 * @param config - optional advisor route and limits from the mount row.
 */
export function apply(ctx: Context, config?: AdvisorLlmConfig): void {
  applySideCommand(ctx)
  if (config === undefined || config.provider === undefined || config.model === undefined) return
  ctx.plugin(QueueAdvisorService, config)
}
