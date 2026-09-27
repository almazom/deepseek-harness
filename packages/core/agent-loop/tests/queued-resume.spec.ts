import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LlmRuntime, { createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, maxTokensResponse, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function send(agent: { followup(input: ReturnType<typeof createUserMessage>): void }, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('queued-prompt resume at the driver boundary', () => {
  it('resumes a queued prompt after the driving turn fails', async () => {
    // A prompt queued while the driver is live never latches a wake: the live
    // driver owns the queue. When that driver dies on an unrecovered request
    // failure, the driver boundary must re-claim the queued prompt itself —
    // otherwise a headless worker strands waiting for a human "continue".
    const adapter = new MockAdapter([
      () => {
        throw new LlmError('provider down', 'PROVIDER')
      },
      textResponse('recovered'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('queued-resume-after-error'), {
      provider: 'mock',
      model: 'mock',
    })
    ctx.on('agent/request-error', async () => {
      // Fires before the failed request's LlmError propagates: the driver is
      // still live, so this send must not need a latch to be delivered.
      send(agent, 'continue')
    })

    send(agent, 'go')
    await agent.whenIdle()

    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
    expect(events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : []))
      .toEqual(['error', 'completed'])
    expect(events.findLast(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'completed' } },
    })
    expect(adapter.requests).toHaveLength(2)
    expect(agent.inbox.nextTurn).toHaveLength(0)
    expect(agent.status).toBe('idle')
  })

  it('keeps a max-tokens turn resumable by a prompt queued during the turn', async () => {
    const adapter = new MockAdapter([
      maxTokensResponse('cut off'),
      textResponse('continued'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('queued-resume-after-max-tokens'), {
      provider: 'mock',
      model: 'mock',
    })
    ctx.on('agent/turn-stopping', ({ turn }) => {
      // Fires after the max-tokens step settled but before the turn polls the
      // queue: the driver is live, so no wake latch protects this prompt.
      if (turn === 1) send(agent, 'continue')
    })

    send(agent, 'go')
    await agent.whenIdle()

    const events = agent.session.snapshotEvents()
    expect(events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : []))
      .toEqual(['max-tokens', 'completed'])
    expect(adapter.requests).toHaveLength(2)
    expect(agent.inbox.nextTurn).toHaveLength(0)
  })
})
