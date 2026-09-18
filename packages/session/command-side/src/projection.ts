/**
 * The `command-side/latest-human` projection unit: folds delivered direct
 * human messages into the newest qualifying anchor that the empty-queue
 * `/side` fallback advises over. Host runtime only.
 * @module @deepseek-ai/dsh-command-side/projection
 */

import { z } from 'zod'
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection/types'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'command-side/latest-human': LatestHumanMessage | null
  }
}

/** The fallback advisory target: the newest delivered direct human message. */
export interface LatestHumanMessage {
  readonly id: MessageId
  readonly text: string
}

const latestHumanStateSchema = z.object({
  id: z.custom<MessageId>(value => typeof value === 'string'),
  text: z.string(),
}).strict()

/** Join one message's text blocks verbatim; non-text blocks contribute nothing. */
export function messageText(content: readonly ContentBlock[]): string {
  return content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * The newest direct human prompt with non-empty text: every qualifying
 * `user/message` overwrites the state, so the fold is deterministic over the
 * log. Injected context (source kinds other than `user`) and attachment-only
 * messages never qualify.
 */
export const latestHumanProjectionDefinition: ProjectionDefinition<'command-side/latest-human', LatestHumanMessage | null> = {
  key: 'command-side/latest-human',
  stateVersion: 1,
  stateSchema: latestHumanStateSchema,
  init: (_header: SessionHeader, _inheritedEventCount: SessionLogOffset): LatestHumanMessage | null => null,
  apply: (state: LatestHumanMessage | null, event: SessionEvent): LatestHumanMessage | null => {
    if (event.type !== 'user/message') return state
    if (event.data.source.kind !== 'user') return state
    const text = messageText(event.data.content)
    if (text === '') return state
    return { id: event.data.id, text }
  },
}
