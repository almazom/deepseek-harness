/**
 * Human-facing `/side` (alias `/btw`) command over the mounted queue advisor:
 * the typed question starts one advisory side run about the most recently
 * queued message, mirroring the queue smart-button advise path.
 * @module @deepseek-ai/dsh-command-side
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-advisor-llm/dispatcher'

export const name = 'command-side'
export const inject = ['commands']

const USAGE = 'Usage: /side <question> — ask the advisor about the latest queued message. /btw is an alias.'

/** Longest queued-message preview kept in the success text. */
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
    ? 'Ask the advisor a side question about the latest queued message'
    : 'Alias of /side: ask the advisor about the latest queued message'
}

/** Shorten one queued message for direct command output without cutting mid-word padding. */
function preview(text: string): string {
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 3)}...` : text
}

/**
 * Fire one advisory run over the most recently queued message. Mirrors the
 * session controller's `advise` queue action: the run starts fire-and-forget
 * (its events stream through the advisor sheet), while the command result
 * only reports the start.
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
  if (latest === undefined) {
    return {
      kind: 'error',
      text: `No queued message to ask about: queue a message while the turn runs, then ask again.\n${USAGE}`,
    }
  }
  const queuedMessage = latest.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  const started = advisor.run({
    session: invocation.agent.session,
    queuedItemId: latest.id,
    queuedMessage,
    question,
  })
  void started.catch((error: unknown): void => {
    ctx.logger.warn(`command-side: advisory run for item "${latest.id}" failed to start: ${String(error)}`)
  })
  return { kind: 'success', text: `Advisor side run started for queued message "${preview(queuedMessage)}".` }
}

export function apply(ctx: Context): void {
  for (const commandName of SIDE_COMMAND_NAMES) {
    ctx.commands.register({
      definitionId: CommandDefinitionId(`@deepseek-ai/dsh-command-side/${commandName}`),
      name: commandName,
      description: commandDescription(commandName),
      input: { hint: '<question>' },
      handler: invocation => executeSideCommand(ctx, invocation),
    })
  }
}
