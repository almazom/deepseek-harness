import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, maxTokensResponse, textResponse, toolCallResponse } from './mock-adapter.ts'
import { AUTO_CONTINUE_BOUND, AUTO_CONTINUE_INSTRUCTION } from '../src/agent.ts'
import {
  COMPACTION_PLACEHOLDER,
  REP_LOOP_LIMIT,
  detectRepLoop,
  isPlaceholderEcho,
} from '../src/rep-loop.ts'

async function harness(adapter: MockAdapter) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

/** Wait for the agent's next transition to idle after a waking send. */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** The kind carried by the agent's last turn/end event (undefined when absent). */
function lastTurnEndKind(agent: Agent): string | undefined {
  const end = agent.session.snapshotEvents().findLast(e => e.type === 'turn/end')
  return end?.type === 'turn/end' ? end.data.reason.kind : undefined
}

function echoMessage(content = COMPACTION_PLACEHOLDER) {
  return { role: 'assistant', content }
}

describe('detectRepLoop', () => {
  it('trips on three consecutive exact-placeholder messages', () => {
    expect(detectRepLoop([echoMessage(), echoMessage(), echoMessage()])).toBe(true)
  })

  it('does not trip on only two echoes', () => {
    expect(detectRepLoop([echoMessage(), echoMessage()])).toBe(false)
  })

  it('never trips on non-placeholder assistant text', () => {
    const clean = [echoMessage('plain'), echoMessage('still plain'), echoMessage('final answer')]
    expect(detectRepLoop(clean)).toBe(false)
  })

  it('trips on a single message containing at least three copies', () => {
    const fat = [echoMessage(`${COMPACTION_PLACEHOLDER} ${COMPACTION_PLACEHOLDER} ${COMPACTION_PLACEHOLDER}`)]
    expect(detectRepLoop(fat)).toBe(true)
  })

  it('stops the walk at a non-assistant message', () => {
    const walk = [
      { role: 'user', content: 'start' },
      echoMessage(),
      echoMessage(),
    ]
    expect(detectRepLoop(walk)).toBe(false)
  })

  it('answers false for an empty transcript', () => {
    expect(detectRepLoop([])).toBe(false)
  })

  it('exposes isPlaceholderEcho for exact and multi-copy text', () => {
    expect(isPlaceholderEcho(`  ${COMPACTION_PLACEHOLDER}  `)).toBe(true)
    expect(isPlaceholderEcho('ordinary assistant answer')).toBe(false)
  })
})

describe('rep-loop guard in the agent turn', () => {
  it('ends the turn with rep-loop-detected within REP_LOOP_LIMIT provider calls', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'echo', { text: 'r1' }, COMPACTION_PLACEHOLDER),
      toolCallResponse('c2', 'echo', { text: 'r2' }, COMPACTION_PLACEHOLDER),
      toolCallResponse('c3', 'echo', { text: 'r3' }, COMPACTION_PLACEHOLDER),
      textResponse('spare — the guard must trip before reaching this step'),
    ])
    const ctx = await harness(adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'echo fixture for the rep-loop guard test',
      parameters: { text: { type: 'string' } },
      async execute(args: { text: string }) {
        return [{ type: 'text' as const, text: args.text }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('rep-loop-trip'), {
      provider: 'mock',
      model: 'mock',
    })
    const idle = waitForIdle(ctx, agent)
    send(agent, 'start the echo loop')
    await idle

    expect(lastTurnEndKind(agent)).toBe('rep-loop-detected')
    expect(adapter.requests.length).toBeLessThanOrEqual(REP_LOOP_LIMIT)
  })

  it('completes a clean turn without tripping the guard', async () => {
    const adapter = new MockAdapter([textResponse('plain answer'), textResponse('spare')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('rep-loop-clean'), {
      provider: 'mock',
      model: 'mock',
    })
    const idle = waitForIdle(ctx, agent)
    send(agent, 'answer normally')
    await idle

    expect(lastTurnEndKind(agent)).toBe('completed')
    expect(adapter.requests.length).toBe(1)
  })
})

describe('bounded auto-continue (TC-008)', () => {
  it('auto-continue: length twice then stop → exactly 3 provider calls', async () => {
    const adapter = new MockAdapter([
      maxTokensResponse('first chunk'),
      maxTokensResponse(' second chunk'),
      textResponse('final chunk'),
    ])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('auto-continue-bound'), {
      provider: 'mock',
      model: 'mock',
    })

    const idle = waitForIdle(ctx, agent)
    send(agent, 'go')
    await idle

    expect(adapter.requests.length).toBe(3)
    expect(lastTurnEndKind(agent)).toBe('completed')
    // Guard-before-continue ordering: every continuation step carries the
    // internal instruction between the cut-off assistant messages.
    const followUps = adapter.requests[1]!.messages.filter(
      m => m.role === 'user' && m.source.kind === 'plugin',
    )
    expect(followUps).toEqual([
      {
        id: expect.any(String) as unknown,
        role: 'user',
        content: [{ type: 'text', text: AUTO_CONTINUE_INSTRUCTION }],
        source: { kind: 'plugin', plugin: 'agent-loop' },
      },
    ])
    expect(adapter.requests[2]!.messages.filter(
      m => m.role === 'user' && m.source.kind === 'plugin',
    )).toHaveLength(2)
  })

  it('empty-content length does not auto-continue', async () => {
    const adapter = new MockAdapter([maxTokensResponse('')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('auto-continue-empty'), {
      provider: 'mock',
      model: 'mock',
    })

    const idle = waitForIdle(ctx, agent)
    send(agent, 'go')
    await idle

    expect(adapter.requests.length).toBe(1)
    expect(lastTurnEndKind(agent)).toBe('max-tokens')
    // No internal instruction may appear anywhere in the transcript.
    expect(JSON.stringify(agent.session.snapshotEvents())).not.toContain(AUTO_CONTINUE_INSTRUCTION)
  })

  it('AUTO_CONTINUE_BOUND is exported and equals 2', () => {
    expect(AUTO_CONTINUE_BOUND).toBe(2)
  })
})
