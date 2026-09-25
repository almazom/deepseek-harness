/**
 * A provider that signals "cut" through a non-standard finish_reason must not
 * become a hard failure: Xiaomi MiMo reports `repetition_truncation` at
 * `completion_tokens: 131072`, and pi-ai renders any unknown reason as
 * `Provider finish_reason: <reason>` on an error stop.
 */
import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, AssistantMessageEvent, Usage } from '@earendil-works/pi-ai'
import { mapStopReason, toStreamChunks } from '../src/stream.ts'

function usage(input = 0, output = 0): Usage {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function assistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'mimo-token-plan',
    model: 'mimo-v2.6-flash',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 0,
    ...overrides,
  }
}

/** The error stop pi-ai builds for a finish_reason it does not recognize. */
function providerCut(reason: string): AssistantMessage {
  return assistant({ stopReason: 'error', errorMessage: 'Provider finish_reason: ' + reason })
}

async function* feed(...events: AssistantMessageEvent[]): AsyncGenerator<AssistantMessageEvent> {
  for (const event of events) yield event
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/**
 * Capture the debug lines a call emits. `vi.spyOn(console, 'debug')` cannot
 * observe the module's console under vitest's console interception, so the
 * global is swapped for the duration of the callback instead.
 * @param run - the operation whose debug output is captured.
 * @returns one string per emitted debug line.
 */
function captureDebug(run: () => void): string[] {
  const original = globalThis.console
  const written: string[] = []
  globalThis.console = {
    ...original,
    debug: (...args: unknown[]) => { written.push(args.map(String).join(' ')) },
  } as unknown as Console
  try {
    run()
  } finally {
    globalThis.console = original
  }
  return written
}

describe('mapStopReason: non-standard provider finish reasons', () => {
  it.each(['repetition_truncation', 'repetition'])('maps the cut reason %s to max-tokens', (reason) => {
    expect(mapStopReason(providerCut(reason))).toEqual({ kind: 'max-tokens' })
  })

  it('keeps content_filter and unknown reasons on the error path, preserving the provider text', () => {
    for (const reason of ['content_filter', 'brand_new_cut']) {
      const mapped = mapStopReason(providerCut(reason))
      expect(mapped.kind).toBe('error')
      expect(mapped.kind === 'error' ? mapped.failure.message : '').toBe('Provider finish_reason: ' + reason)
    }
  })

  it('does not touch an error that names no provider finish_reason', () => {
    const mapped = mapStopReason(assistant({ stopReason: 'error', errorMessage: 'HTTP 500 upstream exploded' }))
    expect(mapped).toEqual({ kind: 'error', failure: { message: 'HTTP 500 upstream exploded', code: 'SERVER' } })
  })

  it('leaves the standard length stop alone', () => {
    expect(mapStopReason(assistant({ stopReason: 'length' }))).toEqual({ kind: 'max-tokens' })
  })

  it('reports a provider cut as a max-tokens finish chunk end to end', async () => {
    const chunks = await collect(toStreamChunks(feed({ type: 'error', reason: 'error', error: providerCut('repetition_truncation') })))
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.type).toBe('usage')
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
  })

  it('records the raw provider reason at debug level', () => {
    const printed = captureDebug(() => {
      expect(mapStopReason(providerCut('repetition_truncation'))).toEqual({ kind: 'max-tokens' })
    }).join('')
    expect(printed).toContain('Provider finish_reason: repetition_truncation')
    expect(printed).toContain('-> max-tokens')
  })

  it('records an unrecognized reason as kept on the error path', () => {
    const printed = captureDebug(() => {
      expect(mapStopReason(providerCut('brand_new_cut')).kind).toBe('error')
    }).join('')
    expect(printed).toContain('brand_new_cut')
    expect(printed).toContain('-> error')
  })
})
