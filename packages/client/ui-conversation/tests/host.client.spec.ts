import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  CONVERSATION_SETTINGS_NAMESPACE, DEFAULT_BUSY_ENTER_BEHAVIOR,
  DEFAULT_SMART_STEER_MIN_CONFIDENCE, apply,
} from '@deepseek-ai/dsh-client-ui-conversation'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-conversation host', () => {
  it('registers, validates, and disposes the durable conversation settings section', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = CONVERSATION_SETTINGS_NAMESPACE
    expect(ctx.settings.get(ns)).toEqual({
      busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR,
      smartSteerMinConfidence: DEFAULT_SMART_STEER_MIN_CONFIDENCE,
    })
    await ctx.settings.update(ns, { busyEnter: 'steer' })
    expect(ctx.settings.get(ns)).toEqual({
      busyEnter: 'steer',
      smartSteerMinConfidence: DEFAULT_SMART_STEER_MIN_CONFIDENCE,
    })
    await expect(ctx.settings.update(ns, { busyEnter: 'invalid' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { smartSteerMinConfidence: 1.5 })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
