import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LlmRuntime, { LlmAdapter, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import QueueAdvisorService from '../src/dispatcher.ts'

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: readonly StreamChunk[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield* this.script
  }
}

class ThrowingAdapter extends LlmAdapter {
  override async * stream(): AsyncIterable<StreamChunk> {
    await Promise.resolve()
    throw new Error('route exploded')
  }
}

function advisorScript(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '{"tail": {"finding": "Editing spec files."}}\n' },
    { type: 'text-delta', index: 0, text: '{"compare": {"finding": "Restates the queued ask."}}\n' },
    { type: 'text-delta', index: 0, text: '{"risk": {"finding": "Interruption drops the edit."}}\n' },
    { type: 'text-delta', index: 0, text: '{"verdict": {"kind": "hold", "confidence": 0.97, "reason": "Mid-edit."}}\n' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

const CONFIG = {
  maxInputBytes: 4_000,
  maxOutputTokens: 256,
  timeoutMs: 2_000,
  tailEntries: 12,
  recentRequests: 5,
  provider: 'fixture',
  model: 'fixture-advisor',
}

/** Real composition: SessionStore + LLM runtime + projection registry, with the
  * external persistence read and the model route stubbed. */
async function bootedContext(
  adapter: LlmAdapter | undefined,
  observedOverride?: unknown,
): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  let observed: unknown = { header: {}, inheritedEventCount: 0, events: [] }
  ctx.provide('sessionQuery', {
    readSession: async () => observed as never,
  } as never)
  if (adapter !== undefined) ctx.llm.registerAdapter(['fixture'], adapter)
  await ctx.plugin(QueueAdvisorService, CONFIG)
  const session = ctx.sessions.create(SessionId('advisor-dispatch'))
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'why is the queue holding this?' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  // oxlint-disable-next-line typescript/no-deprecated -- test-file allowance feeds the observed log to the stub reader
  observed = observedOverride ?? { header: {}, inheritedEventCount: 0, events: session.snapshotEvents() }
  return { ctx, session }
}

function eventsOf(session: Session): { type: string; data: Record<string, unknown>; seq: number }[] {
  // oxlint-disable-next-line typescript/no-deprecated -- test-file allowance inspects the emitted log
  return session.snapshotEvents().map(event => ({ type: event.type, data: event.data as Record<string, unknown>, seq: event.seq }))
}

describe('QueueAdvisorService.run', () => {
  it('lands the request, the streamed steps, and the verdict in the log', async () => {
    const adapter = new ScriptedAdapter(advisorScript())
    const { ctx, session } = await bootedContext(adapter)
    const runId = await ctx.queueAdvisor!.run({
      session, queuedItemId: 'queued-1', queuedMessage: 'send it now?', question: 'а сейчас?',
    })
    const events = eventsOf(session)
    expect(events.map(event => event.type)).toEqual([
      'user/message',
      'advisor/run-requested',
      'advisor/step',
      'advisor/step',
      'advisor/step',
      'advisor/verdict',
    ])
    expect(runId).toBe('1')
    expect(events[1]).toMatchObject({
      seq: 1,
      data: { queuedItemId: 'queued-1', messageSeqs: [0], maxTokens: CONFIG.maxOutputTokens },
    })
    expect(events.slice(2)).toMatchObject([
      { data: { runId: '1', step: 'tail', finding: 'Editing spec files.' } },
      { data: { runId: '1', step: 'compare', finding: 'Restates the queued ask.' } },
      { data: { runId: '1', step: 'risk', finding: 'Interruption drops the edit.' } },
      { data: { runId: '1', kind: 'hold', confidence: 0.97, reason: 'Mid-edit.' } },
    ])
    expect(adapter.requests[0]).toMatchObject({ provider: 'fixture', model: 'fixture-advisor', maxTokens: 256 })
  })

  it('lands advisor/failed when the verdict section breaks the contract', async () => {
    const broken: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"tail": {"finding": "fine"}}\n' },
      { type: 'text-delta', index: 0, text: '{"verdict": {"kind": "explode", "confidence": 2}}\n' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const { ctx, session } = await bootedContext(new ScriptedAdapter(broken))
    const runId = await ctx.queueAdvisor!.run({ session, queuedItemId: 'queued-1', queuedMessage: 'send it now?' })
    const events = eventsOf(session)
    expect(events.at(-1)).toMatchObject({ type: 'advisor/failed', data: { runId, reason: 'verdict section did not match the advisory contract' } })
  })

  it('lands advisor/failed when the stream closes before the verdict section', async () => {
    const truncated: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"tail": {"finding": "fine"}}\n' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const { ctx, session } = await bootedContext(new ScriptedAdapter(truncated))
    const runId = await ctx.queueAdvisor!.run({ session, queuedItemId: 'queued-1', queuedMessage: 'send it now?' })
    expect(eventsOf(session).at(-1)).toMatchObject({
      type: 'advisor/failed',
      data: { runId, reason: 'advisory output closed before the verdict section' },
    })
  })

  it('lands advisor/failed with the model error when the stream throws', async () => {
    const { ctx, session } = await bootedContext(new ThrowingAdapter())
    const runId = await ctx.queueAdvisor!.run({ session, queuedItemId: 'queued-1', queuedMessage: 'send it now?' })
    expect(eventsOf(session).at(-1)).toMatchObject({
      type: 'advisor/failed',
      data: { runId, reason: 'route exploded' },
    })
  })

  it('lands advisor/failed when the configured route has no registered adapter', async () => {
    const { ctx, session } = await bootedContext(undefined)
    const runId = await ctx.queueAdvisor!.run({ session, queuedItemId: 'queued-1', queuedMessage: 'send it now?' })
    expect(eventsOf(session).at(-1)).toMatchObject({
      type: 'advisor/failed',
      data: { runId, reason: 'no adapter registered for provider "fixture"' },
    })
  })

  it('lands advisor/failed without a run id when framing fails before dispatch', async () => {
    const { ctx, session } = await bootedContext(new ScriptedAdapter([]))
    const runId = await ctx.queueAdvisor!.run({
      session, queuedItemId: 'queued-1', queuedMessage: 'x'.repeat(5_000),
    })
    expect(runId).toBeNull()
    expect(eventsOf(session).map(event => event.type)).not.toContain('advisor/run-requested')
    expect(eventsOf(session).at(-1)).toMatchObject({
      type: 'advisor/failed',
      data: { runId: null, reason: 'smart_steer: queued message exceeds maxInputBytes' },
    })
  })

  it('drops unknown keys and malformed finding sections while a valid verdict still settles', async () => {
    const noisy: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '{"note": {"finding": "noise"}}\n' },
      { type: 'text-delta', index: 0, text: '{"tail": {"oops": 1}}\n' },
      { type: 'text-delta', index: 0, text: '{"tail": {"finding": "Editing spec files."}}\n' },
      { type: 'text-delta', index: 0, text: '{"verdict": {"kind": "hold", "confidence": 0.97, "reason": "Mid-edit."}}\n' },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const { ctx, session } = await bootedContext(new ScriptedAdapter(noisy))
    const runId = await ctx.queueAdvisor!.run({ session, queuedItemId: 'queued-1', queuedMessage: 'send it now?' })
    const steps = eventsOf(session).filter(event => event.type === 'advisor/step')
    expect(steps.map(event => event.data)).toEqual([
      { runId, step: 'tail', finding: 'Editing spec files.' },
    ])
    expect(eventsOf(session).at(-1)).toMatchObject({ type: 'advisor/verdict', data: { runId } })
  })

  it('frames the snapshot from the observed log: both roles, empty text skipped, duplicate requests deduped', async () => {
    const observed = {
      header: {},
      inheritedEventCount: 0,
      events: [
        { type: 'user/message', seq: 0, time: 1, data: createUserMessage({
          content: [{ type: 'text', text: 'почини тесты' }],
          source: { kind: 'user' },
        }) },
        { type: 'assistant/message', seq: 1, time: 2, data: {
          turn: 1, step: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: 'тесты починены' }] },
        } },
        { type: 'user/message', seq: 2, time: 3, data: createUserMessage({
          content: [{ type: 'text', text: 'почини тесты' }],
          source: { kind: 'user' },
        }) },
        { type: 'user/message', seq: 3, time: 4, data: createUserMessage({
          content: [{ type: 'text', text: '' }],
          source: { kind: 'user' },
        }) },
        { type: 'user/message', seq: 4, time: 5, data: createUserMessage({
          content: [{ type: 'text', text: 'tool echo' }],
          source: { kind: 'tool', callId: ToolCallId('call-1') },
        }) },
        { type: 'assistant/message', seq: 5, time: 6, data: {
          turn: 2, step: 1,
          message: { role: 'assistant', content: [{ type: 'text', text: '' }] },
        } },
        { type: 'advisor/run-requested', seq: 6, time: 7, data: {} },
      ],
    }
    const adapter = new ScriptedAdapter(advisorScript())
    const { ctx, session } = await bootedContext(adapter, observed)
    await ctx.queueAdvisor!.run({ session, queuedItemId: 'queued-1', queuedMessage: 'отправить?' })
    const snapshot = JSON.parse(
      (adapter.requests[0]!.messages[0]!.content as { type: string; text: string }[])[0]!.text,
    ) as { queuedMessage: string; tail: { role: string; text: string }[]; recentRequests: string[] }
    expect(snapshot.queuedMessage).toBe('отправить?')
    expect(snapshot.tail).toEqual([
      { role: 'user', text: 'почини тесты', seq: 0 },
      { role: 'assistant', text: 'тесты починены', seq: 1 },
      { role: 'user', text: 'почини тесты', seq: 2 },
    ])
    expect(snapshot.recentRequests).toEqual(['почини тесты'])
    expect(eventsOf(session)[1]).toMatchObject({ data: { messageSeqs: [0, 2] } })
  })

  it('refuses to mount without an explicit provider/model pair', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionProjectionRegistry)
    ctx.provide('sessionQuery', { readSession: async () => ({ header: {}, inheritedEventCount: 0, events: [] }) } as never)
    await expect(ctx.plugin(QueueAdvisorService, { ...CONFIG, provider: undefined, model: undefined } as never))
      .rejects.toThrow(/requires an explicit provider\/model pair/)
  })
})
