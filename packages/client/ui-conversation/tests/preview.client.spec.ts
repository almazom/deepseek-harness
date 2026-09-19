// @vitest-environment jsdom
/** Newest human transcript preview extraction from conversation nodes. */
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ConversationNode } from '../src/client/contract/records.ts'
import { lastHumanPreview } from '../src/client/queue/preview.ts'

const user = (text: string, seq = 1): ConversationNode => ({
  kind: 'user', seq, time: seq, source: { kind: 'user' },
  content: [{ type: 'text', text }],
})

const steering = (text: string, seq = 1): ConversationNode => ({
  kind: 'steering', messageId: `m${seq}` as never, seq, time: seq, source: { kind: 'user' },
  content: [{ type: 'text', text }],
})

const assistant = (seq = 1): ConversationNode => ({
  kind: 'assistant', seq, time: seq, turn: 1, step: 1, blocks: [],
})

const CONTEXT: ConversationNode = {
  kind: 'context', seq: 0, time: 0, source: { kind: 'plugin', plugin: 'compact' },
  content: [{ type: 'text', text: 'summary' }],
} as unknown as ConversationNode

describe('lastHumanPreview', () => {
  it('returns the newest human preview across user and steering nodes', () => {
    expect(lastHumanPreview([user('первый', 1), steering('поправка', 2)])).toBe('поправка')
  })

  it('skips non-human nodes', () => {
    expect(lastHumanPreview([CONTEXT, assistant(2), user('вопрос', 3)])).toBe('вопрос')
  })

  it('skips attachment-only human nodes in favor of the next older preview', () => {
    const imageOnly = {
      kind: 'user', seq: 2, time: 2, source: { kind: 'user' },
      content: [{ type: 'image' } as unknown as ContentBlock],
    } as ConversationNode
    expect(lastHumanPreview([user('текст', 1), imageOnly])).toBe('текст')
  })

  it('returns undefined before any human input', () => {
    expect(lastHumanPreview([CONTEXT, assistant(2)])).toBeUndefined()
    expect(lastHumanPreview([])).toBeUndefined()
  })
})
