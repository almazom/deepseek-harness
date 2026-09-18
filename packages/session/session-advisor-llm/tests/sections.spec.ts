import { describe, expect, it } from 'vitest'
import type { Message } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  ADVISOR_STEP_IDS,
  AdvisorSectionWatcher,
  buildAdvisorMessages,
  buildAdvisorSystemPrompt,
  resolveAdvisorLlmConfig,
} from '../src/index.ts'
import type { AdvisorLlmConfig } from '../src/types.ts'

const GOOD_OUTPUT = [
  '{"tail": {"finding": "The agent is mid-edit on advisor.spec.ts."},',
  ' "compare": {"finding": "The queued message restates the current instruction."},',
  ' "risk": {"finding": "Interruption would drop the pending edit."},',
  ' "verdict": {"kind": "hold", "confidence": 0.97, "reason": "Mid-edit."}}',
].join('\n')

/** Extract the text of a message's first text block, failing the test when absent. */
function textOf(message: Pick<Message, 'content'>): string {
  const block = message.content[0]
  if (block === undefined || block.type !== 'text') throw new Error('no text block')
  return block.text
}

describe('AdvisorSectionWatcher', () => {
  it('emits each fixed section in order when the stream arrives whole', () => {
    const watcher = new AdvisorSectionWatcher()
    const sections = watcher.push(GOOD_OUTPUT)
    expect(sections.map(s => s.key)).toEqual(['tail', 'compare', 'risk', 'verdict'])
    expect(JSON.parse(sections[3]!.raw)).toEqual({
      kind: 'hold',
      confidence: 0.97,
      reason: 'Mid-edit.',
    })
    expect(watcher.finish()).toEqual({
      keys: ['tail', 'compare', 'risk', 'verdict'],
      closed: true,
    })
  })

  it('emits sections progressively across split deltas, not at the end', () => {
    const watcher = new AdvisorSectionWatcher()
    const first = watcher.push('{"tail": {"finding": "Beg')
    expect(first).toEqual([])
    const second = watcher.push('ins now."}')
    expect(second.map(s => s.key)).toEqual(['tail'])
    expect(JSON.parse(second[0]!.raw)).toEqual({ finding: 'Begins now.' })
    const rest = watcher.push(', "compare": {"finding": "c"}')
    expect(rest.map(s => s.key)).toEqual(['compare'])
  })

  it('keeps brace-bearing string values intact across deltas', () => {
    const watcher = new AdvisorSectionWatcher()
    watcher.push('{"tail": {"finding": "keeps } and { literal"}')
    const rest = watcher.push(', "compare": {"finding": "ok"}}')
    expect(JSON.parse(rest[0]!.raw)).toEqual({ finding: 'ok' })
    expect(watcher.finish()).toEqual({ keys: ['tail', 'compare'], closed: true })
  })

  it('keeps escape sequences and multibyte text intact', () => {
    const watcher = new AdvisorSectionWatcher()
    const sections = watcher.push(
      '{"tail": {"finding": "quote \\" here — хвост — 尾"}, "compare": {"finding": "✓"}}',
    )
    expect(JSON.parse(sections[0]!.raw)).toEqual({ finding: 'quote " here — хвост — 尾' })
    expect(JSON.parse(sections[1]!.raw)).toEqual({ finding: '✓' })
    expect(watcher.finish()).toEqual({ keys: ['tail', 'compare'], closed: true })
  })

  it('emits unknown top-level keys in closure order and reports a truncated stream', () => {
    const watcher = new AdvisorSectionWatcher()
    const sections = watcher.push('{"extra": {"n": 1}, "tail": {"finding": "x"')
    expect(sections.map(s => s.key)).toEqual(['extra'])
    expect(watcher.finish()).toEqual({ keys: ['extra'], closed: false })
  })

  it('closes the final section at the root brace', () => {
    const watcher = new AdvisorSectionWatcher()
    const sections = watcher.push(GOOD_OUTPUT)
    expect(sections[sections.length - 1]!.key).toBe('verdict')
    expect(watcher.finish().closed).toBe(true)
  })

  it('excludes the root brace from a primitive-valued final section', () => {
    const watcher = new AdvisorSectionWatcher()
    const sections = watcher.push('{"tail": {"finding": "x"}, "note": "hi"}')
    expect(sections.map(s => s.key)).toEqual(['tail', 'note'])
    expect(sections[1]!.raw).toBe('"hi"')
    expect(watcher.finish().closed).toBe(true)
  })
})

describe('resolveAdvisorLlmConfig', () => {
  const base: AdvisorLlmConfig = {
    maxInputBytes: 8192,
    maxOutputTokens: 512,
    timeoutMs: 15000,
    tailEntries: 12,
    recentRequests: 5,
  }

  it('accepts the minimal policy and freezes the resolved copy', () => {
    const resolved = resolveAdvisorLlmConfig(base)
    expect(resolved).toEqual(base)
    expect(Object.isFrozen(resolved)).toBe(true)
  })

  it('rejects unknown keys, unpaired routes, and non-positive limits', () => {
    expect(() => resolveAdvisorLlmConfig({ ...base, extra: 1 } as AdvisorLlmConfig)).toThrow(
      'unknown config key "extra"',
    )
    expect(() =>
      resolveAdvisorLlmConfig({ ...base, provider: 'p' }),
    ).toThrow('provider and model must be paired')
    expect(() => resolveAdvisorLlmConfig({ ...base, maxOutputTokens: 0 })).toThrow(
      'maxOutputTokens must be a positive integer',
    )
    expect(() => resolveAdvisorLlmConfig(null as unknown as AdvisorLlmConfig)).toThrow(
      'configuration is required',
    )
    expect(() => resolveAdvisorLlmConfig({ ...base, timeoutMs: MAX_TIMER_DELAY_MS + 1 })).toThrow(
      `timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`,
    )
  })
})

describe('buildAdvisorMessages', () => {
  const snapshot = {
    queuedMessage: 'stop and run the tests',
    tail: [
      { role: 'user' as const, text: 'implement the advisor' },
      { role: 'assistant' as const, text: 'working on it' },
    ],
    recentRequests: ['implement the advisor'],
  }

  it('frames the snapshot as one JSON user message under the byte cap', () => {
    const messages = buildAdvisorMessages({ ...snapshot, maxInputBytes: 8192 })
    expect(messages).toHaveLength(1)
    const framed = JSON.parse(textOf(messages[0]!)) as typeof snapshot
    expect(framed.queuedMessage).toBe('stop and run the tests')
    expect(framed.tail).toHaveLength(2)
  })

  it('drops the oldest tail entries until the complete frame fits', () => {
    const big = { ...snapshot, tail: [...snapshot.tail, { role: 'assistant' as const, text: 'x'.repeat(4000) }] }
    const messages = buildAdvisorMessages({ ...big, maxInputBytes: 4200 })
    const framed = JSON.parse(textOf(messages[0]!)) as typeof big
    expect(framed.tail.length).toBeLessThan(3)
    expect(framed.queuedMessage).toBe('stop and run the tests')
  })

  it('frames an operator follow-up as the question over the queued context', () => {
    const messages = buildAdvisorMessages({ ...snapshot, question: 'а логи ты смотрел?', maxInputBytes: 8192 })
    const framed = JSON.parse(textOf(messages[0]!)) as { followUp?: string; queuedMessage: string }
    expect(framed.followUp).toBe('а логи ты смотрел?')
    expect(framed.queuedMessage).toBe('stop and run the tests')
  })

  it('rejects a queued message that cannot fit at all', () => {
    expect(() =>
      buildAdvisorMessages({ ...snapshot, queuedMessage: 'y'.repeat(200), maxInputBytes: 100 }),
    ).toThrow('queued message exceeds maxInputBytes')
  })

  it('rejects a frame whose tail cannot shrink below the byte cap', () => {
    expect(() =>
      buildAdvisorMessages({
        ...snapshot,
        queuedMessage: 'q',
        tail: [{ role: 'assistant' as const, text: 'z'.repeat(50) }],
        recentRequests: [],
        maxInputBytes: 40,
      }),
    ).toThrow('snapshot exceeds maxInputBytes')
  })
})

describe('advisor run contract', () => {
  it('pins the fixed phase order and the JSON section contract', () => {
    expect(ADVISOR_STEP_IDS).toEqual(['tail', 'compare', 'risk', 'verdict'])
    const system = buildAdvisorSystemPrompt()
    for (const key of ADVISOR_STEP_IDS) expect(system).toContain(`"${key}"`)
    expect(system).toContain('send-now')
    expect(system).toContain('hold')
  })
})
