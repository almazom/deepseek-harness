/** Smart-steer client half: the advisor surface behind ui-conversation's dock slot. */
import type { Context } from '@deepseek-ai/cordis'
// Loads Context.locale and Context.slots declarations the client services own.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SmartSteerKey } from './locales.ts'
import { AdvisorSurface } from './AdvisorSurface.tsx'
import { NS, en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Smart-steer advisor sheet copy, owned by this plugin. */
    'smart-steer': SmartSteerKey
  }
}

/** Client services required by the Smart-steer surface. */
export const inject = ['slots', 'locale']

/**
 * Mount the Smart-steer client surface. The queue dock owns the advisor
 * lifecycle and hands every fact through the slot's owner share; this plugin
 * only contributes the renderer into `conversation.input.dock.advisor`.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  const locale = ctx.locale

  ctx.effect(() => locale.register(NS, { zh, en }), 'smart-steer: dictionaries')
  ctx.slots.inject('conversation.input.dock.advisor', () => ctx.slots.register({
    name: 'conversation.input.dock.advisor',
    priority: 10,
    locale: NS,
  }, AdvisorSurface))
}

/** The dock-slot contract this package owns; ui-conversation's queue dock consumes it. */
export type { AdvisorOwnerProps } from './owner.ts'
// The advisor session event and projection map merges ride with the client
// face, so consumer programs (the queue dock) see the advisor keys.
export type { AdvisorRunProjection } from '../types.ts'
