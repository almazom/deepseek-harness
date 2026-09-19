/**
 * Human-facing `/side` (alias `/btw`) command over the mounted queue advisor:
 * the typed question starts one advisory side run about the most recently
 * queued message, mirroring the queue smart-button advise path; with an empty
 * queue it falls back to the latest delivered human message so the command
 * works whenever the conversation has one.
 * @module @deepseek-ai/dsh-smart-steer/side-command
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-smart-steer/dispatcher'
import { latestHumanProjectionDefinition, messageText } from './latest-human.ts'

const USAGE = 'Usage: /side <question> — ask the advisor about the latest queued message, or the latest conversation message when the queue is empty. /btw is an alias.'

/** Longest advised-message preview kept in the success text. */
const PREVIEW_LIMIT = 80

/**
 * Spellings of the side-question command. The command registry has no alias
 * concept, so each spelling registers its own definition wired to the same
 * handler; both appear in discovery with the alias marked as such.
 */
const SIDE_COMMAND_NAMES = ['side', 'btw'] as const

/** Command description per registered spelling. */
function commandDescription(commandName: string): string {
  return commandName === 'side'
    ? 'Ask the advisor a side question about the current conversation'
    : 'Alias of /side: ask the advisor about the current conversation'
}

/** Shorten one advised message for direct command output without cutting mid-word padding. */
function preview(text: string): string {
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 3)}...` : text
}

/**
 * Fire one advisory run over the most recently queued message, or — when the
 * queue is empty — over the latest delivered human message. The run starts
 * fire-and-forget (its events stream through the advisor sheet), while the
 * command result only reports the start.
 */
function executeSideCommand(ctx: Context, invocation: CommandInvocation): CommandResult {
  const question = invocation.rawInput.trim()
  if (question.length === 0) {
    return { kind: 'error', text: `A side question is required.\n${USAGE}` }
  }
  const advisor = ctx.get('queueAdvisor')
  if (advisor === undefined) {
    return { kind: 'error', text: 'This deployment mounts no queue advisor, so /side has no advisor to ask.' }
  }
  const latest = invocation.agent.inbox.nextTurn.at(-1) ?? invocation.agent.inbox.nextStep.at(-1)
  let anchoredId: MessageId
  let advisedText: string
  if (latest !== undefined) {
    anchoredId = latest.id
    advisedText = messageText(latest.content)
  } else {
    // The empty-queue fallback reads maintained projection state, never a
    // synchronous scan of historical events.
    const anchor = ctx.sessionProjections.stateOf(invocation.agent.session, 'smart_steer/latest-human')
    if (anchor === undefined || anchor === null) {
      return {
        kind: 'error',
        text: `No message to advise about yet: send a message first, then ask again.\n${USAGE}`,
      }
    }
    anchoredId = anchor.id
    advisedText = anchor.text
  }
  const started = advisor.run({
    session: invocation.agent.session,
    queuedItemId: anchoredId,
    queuedMessage: advisedText,
    question,
  })
  void started.catch((error: unknown): void => {
    ctx.logger.warn(`smart_steer: advisory run for item "${anchoredId}" failed to start: ${String(error)}`)
  })
  return latest !== undefined
    ? { kind: 'success', text: `Advisor side run started for queued message "${preview(advisedText)}".` }
    : { kind: 'success', text: `Advisor side run started for the latest message "${preview(advisedText)}".` }
}

/**
 * Register the `/side` (`/btw`) commands and the latest-human projection; the
 * merged `smart_steer` root plugin calls this from its `apply`.
 * @param ctx - Cordis context providing the command and projection registries.
 */
export function applySideCommand(ctx: Context): void {
  ctx.sessionProjections.register(latestHumanProjectionDefinition)
  for (const commandName of SIDE_COMMAND_NAMES) {
    ctx.commands.register({
      definitionId: CommandDefinitionId(`@deepseek-ai/dsh-smart-steer/${commandName}`),
      name: commandName,
      description: commandDescription(commandName),
      input: { hint: '<question>' },
      handler: invocation => executeSideCommand(ctx, invocation),
    })
  }
}
