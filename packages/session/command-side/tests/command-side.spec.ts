import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { QueueAdvisorRequest } from '@deepseek-ai/dsh-session-advisor-llm/dispatcher'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as commandSide from '@deepseek-ai/dsh-command-side'
import { latestHumanProjectionDefinition } from '../src/projection.ts'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'

const USAGE_SNIPPET = 'Usage: /side <question>'

interface Harness {
  readonly ctx: Context
  readonly agent: Agent
  readonly session: Session
  readonly plugin: Awaited<ReturnType<Context['plugin']>>
  readonly advisorRuns: QueueAdvisorRequest[]
}

/** Build a live idle agent whose inbox accepts queued fixtures. */
function stubAgent(ctx: Context, id: string): { agent: Agent; session: Session } {
  // Store-created: the command executor durably logs lifecycle events on it.
  const session = ctx.sessions.create(SessionId(id))
  const inbox = createInboxStub()
  let status: AgentStatus = 'idle'
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    get status() { return status },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() { status = 'idle' },
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

interface StubAdvisorOptions {
  /** Collected run requests, in arrival order. */
  readonly runs: QueueAdvisorRequest[]
  /** When set, every run start rejects like a dead advisor route. */
  readonly failStart?: boolean | undefined
}

/** Production-shaped queueAdvisor double: a real cordis Service on the slot. */
class StubAdvisorService extends Service {
  constructor(ctx: Context, options: StubAdvisorOptions) {
    super(ctx, 'queueAdvisor')
    this.options = options
  }

  readonly options: StubAdvisorOptions

  run(request: QueueAdvisorRequest): Promise<string | null> {
    if (this.options.failStart) return Promise.reject(new Error('route down'))
    this.options.runs.push(request)
    return Promise.resolve('1')
  }
}

/**
 * Mount the real command registry plus the producer; the advisory dispatcher
 * is a Service-backed stub so tests observe the exact run requests.
 */
async function harness(options: { advisor?: boolean; failStart?: boolean } = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  const advisorRuns: QueueAdvisorRequest[] = []
  if (options.advisor !== false) {
    await ctx.plugin(StubAdvisorService, { runs: advisorRuns, failStart: options.failStart })
  }
  const plugin = await ctx.plugin(commandSide)
  const { agent, session } = stubAgent(ctx, `command-side-${Math.random()}`)
  ctx.agents.register(agent)
  return { ctx, agent, session, plugin, advisorRuns }
}

/** Execute a `/side`-family line through the same registry boundary as a UI adapter. */
async function run(test: Harness, line: string): Promise<NonNullable<Awaited<ReturnType<CommandRuntime['execute']>>>['result']> {
  const execution = await test.ctx.commands.execute(
    test.agent,
    line,
    [],
    new AbortController().signal,
  )
  if (execution === undefined) throw new Error(`${line.split(' ')[0]} command was not registered`)
  return execution.result
}

/** Queue one text message into the inbox slot a caller names. */
function queue(test: Harness, text: string, target: 'next-turn' | 'next-step' = 'next-turn'): void {
  test.agent.inbox.append(target, createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
}

/** Append one delivered human message to the session log. */
function deliver(test: Harness, text: string): string {
  const message = createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
  test.session.append('user/message', message, { surfaceOp: 'append' })
  return message.id
}

describe('@deepseek-ai/dsh-command-side registration', () => {
  it('registers both spellings with Loader-safe exports and disposes them', async () => {
    const test = await harness()
    expect(commandSide.name).toBe('command-side')
    expect(commandSide.inject).toEqual(['commands', 'sessionProjections'])
    expect('default' in commandSide).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    expect(loader.unwrapExports(commandSide)).toBe(commandSide)

    const listed = test.ctx.commands.list(test.agent)
    expect(listed).toContainEqual({
      definitionId: '@deepseek-ai/dsh-command-side/side',
      name: 'side',
      description: 'Ask the advisor a side question about the current conversation',
      input: { hint: '<question>' },
    })
    expect(listed).toContainEqual({
      definitionId: '@deepseek-ai/dsh-command-side/btw',
      name: 'btw',
      description: 'Alias of /side: ask the advisor about the current conversation',
      input: { hint: '<question>' },
    })
    expect(test.ctx.commands.find(test.agent, 'side')).toBeDefined()
    expect(test.ctx.commands.find(test.agent, 'btw')).toBeDefined()

    await test.plugin.dispose()
    expect(test.ctx.commands.find(test.agent, 'side')).toBeUndefined()
    expect(test.ctx.commands.find(test.agent, 'btw')).toBeUndefined()
  })
})

describe('/side and /btw execution', () => {
  it('starts one advisory run over the latest queued turn message with the typed question', async () => {
    const test = await harness()
    queue(test, 'почини тесты')
    queue(test, 'also run the typecheck')

    const result = await run(test, '/side did you check the failing log first?')
    expect(result).toEqual({
      kind: 'success',
      text: 'Advisor side run started for queued message "also run the typecheck".',
    })
    expect(test.advisorRuns).toHaveLength(1)
    expect(test.advisorRuns[0]).toMatchObject({
      queuedItemId: test.agent.inbox.nextTurn.at(-1)?.id,
      queuedMessage: 'also run the typecheck',
      question: 'did you check the failing log first?',
    })
    expect(test.advisorRuns[0]?.session).toBe(test.session)
  })

  it('accepts the /btw alias and falls back to the latest next-step item', async () => {
    const test = await harness()
    queue(test, 'mid-step inspection', 'next-step')

    const result = await run(test, '/btw what is blocking?')
    expect(result.kind).toBe('success')
    expect(test.advisorRuns).toHaveLength(1)
    expect(test.advisorRuns[0]).toMatchObject({
      queuedMessage: 'mid-step inspection',
      question: 'what is blocking?',
    })
  })

  it('trims the question and refuses a blank one', async () => {
    const test = await harness()

    const blank = await run(test, '/side   ')
    expect(blank.kind).toBe('error')
    expect(blank.text).toContain('A side question is required.')
    expect(blank.text).toContain(USAGE_SNIPPET)
  })

  it('falls back to the latest delivered human message when the queue is empty', async () => {
    const test = await harness()
    const first = deliver(test, 'почини тесты')
    const second = deliver(test, 'now look at the failing log')

    const result = await run(test, '/side what did you check first?')
    expect(result).toEqual({
      kind: 'success',
      text: 'Advisor side run started for the latest message "now look at the failing log".',
    })
    expect(test.advisorRuns).toHaveLength(1)
    expect(test.advisorRuns[0]).toMatchObject({
      queuedItemId: second,
      queuedMessage: 'now look at the failing log',
      question: 'what did you check first?',
    })
    expect(first).not.toBe(second)
  })

  it('never advises over injected context or assistant messages in the fallback', async () => {
    const test = await harness()
    deliver(test, 'the real question')
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'file-change notice injected by the host' }],
      source: { kind: 'agent.inject' as never },
    }), { surfaceOp: 'append' })

    const result = await run(test, '/side about what?')
    expect(result.kind).toBe('success')
    expect(test.advisorRuns[0]).toMatchObject({
      queuedMessage: 'the real question',
    })
  })

  it('skips attachment-only human messages in the fallback', async () => {
    const test = await harness()
    deliver(test, 'the real question')
    test.session.append('user/message', createUserMessage({
      content: [{ type: 'image', attachment: { attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } as never }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const result = await run(test, '/side about what?')
    expect(result.kind).toBe('success')
    expect(test.advisorRuns[0]).toMatchObject({
      queuedMessage: 'the real question',
    })
  })

  it('errors on an empty queue when the session has no delivered human message', async () => {
    const drained = await harness()
    const noQueue = await run(drained, '/side anything?')
    expect(noQueue.kind).toBe('error')
    expect(noQueue.text).toContain('No message to advise about yet:')
    expect(noQueue.text).toContain(USAGE_SNIPPET)
    expect(drained.advisorRuns).toHaveLength(0)
  })

  it('errors without a mounted advisor and without hitting the inbox', async () => {
    const test = await harness({ advisor: false })
    queue(test, 'queued work')

    const result = await run(test, '/side anything?')
    expect(result).toEqual({
      kind: 'error',
      text: 'This deployment mounts no queue advisor, so /side has no advisor to ask.',
    })
    expect(test.agent.inbox.nextTurn).toHaveLength(1)
  })

  it('keeps the command successful when the advisory run fails to start and logs a warning', async () => {
    const test = await harness({ failStart: true })
    const warn = vi.spyOn(test.ctx.logger, 'warn')
    queue(test, 'queued work')

    const result = await run(test, '/side anything?')
    expect(result.kind).toBe('success')
    expect(test.advisorRuns).toHaveLength(0)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to start: Error: route down'))
    })
  })

  it('previews queued text over the preview limit without altering the run request', async () => {
    const test = await harness()
    const longText = 'x'.repeat(120)
    queue(test, longText)

    const result = await run(test, '/side summarize')
    expect(result).toEqual({
      kind: 'success',
      text: `Advisor side run started for queued message "${'x'.repeat(77)}...".`,
    })
    expect(test.advisorRuns[0]?.queuedMessage).toBe(longText)
  })

  it('validates the projection state schema on durable readback', () => {
    const state = { id: 'm-1', text: 'почини тесты' }
    expect(latestHumanProjectionDefinition.stateSchema.parse(state)).toEqual(state)
    expect(latestHumanProjectionDefinition.stateSchema.safeParse({ ...state, id: 7 }).success).toBe(false)
    expect(latestHumanProjectionDefinition.stateSchema.safeParse({ ...state, extra: true }).success).toBe(false)
  })
})
