import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { chatNode } from './common.ts'
import { applyHookResult, hookRunOfInvoked, type HookRunView } from './event-projection.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Hook telemetry runs recorded inside one Turn. */
    hooks: HooksChatData
  }
}

/** Payload of the keyed `hooks` Chat renderer. */
export interface HooksChatData {
  readonly hooks: readonly HookRunView[]
}

export interface HooksState {
  readonly turn: number
  readonly runs: readonly HookRunView[]
}

/** Per-turn hook telemetry Definition. */
export const hooksDefinition: ConversationNodeDefinition<HooksState> = {
  kind: 'hooks',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'hook/invoked' || event.type === 'hook/result') {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('hooks start requires turn/start')
    return { turn: match.event.data.turn, runs: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'hook/invoked') {
      return { ...context.state, runs: [...context.state.runs, hookRunOfInvoked(match.event.data)] }
    }
    if (match.event.type === 'hook/result') {
      return { ...context.state, runs: applyHookResult(context.state.runs, match.event.data) }
    }
    return context.state
  },
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined || state.runs.length === 0) return null
    return chatNode(context, 'hooks', context.start?.event.seq ?? 0, { hooks: state.runs })
  },
}

/**
 * Register the hook-telemetry business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerHooksConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(hooksDefinition)
}
