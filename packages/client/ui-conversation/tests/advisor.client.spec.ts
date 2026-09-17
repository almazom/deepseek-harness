// @vitest-environment jsdom
/** Deterministic tier-1 advisor: verdict classification and transcript preview extraction. */
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ConversationNode } from '../src/client/contract/records.ts'
import { advise, lastHumanPreview } from '../src/client/queue/advisor.ts'

const user = (text: string, seq = 1): ConversationNode => ({
  kind: 'user', seq, time: seq, source: { kind: 'user' },
  content: [{ type: 'text', text }],
}) as ConversationNode

const steering = (text: string, seq = 1): ConversationNode => ({
  kind: 'steering', messageId: `m${seq}` as never, seq, time: seq, source: { kind: 'user' },
  content: [{ type: 'text', text }],
}) as ConversationNode

const assistant = (seq = 1): ConversationNode => ({
  kind: 'assistant', seq, time: seq, turn: 1, step: 1, blocks: [],
}) as ConversationNode

const CONTEXT: ConversationNode = {
  kind: 'context', seq: 0, time: 0, source: { kind: 'plugin', plugin: 'compact' },
  content: [{ type: 'text', text: 'summary' }],
} as unknown as ConversationNode

describe('tier-1 advisor verdicts', () => {
  const base = { running: true, queuedCount: 1 }

  it('classifies a short English interrogative row as a status probe', () => {
    expect(advise({ ...base, rowText: 'what is happening now?' })).toEqual({
      kind: 'status', reasonKey: 'advisor.verdict.status',
    })
  })

  it('classifies a short Russian probe as a status question', () => {
    expect(advise({ ...base, rowText: '  что происходит?  ' })).toEqual({
      kind: 'status', reasonKey: 'advisor.verdict.status',
    })
  })

  it('defers a short row that is not a question', () => {
    expect(advise({ ...base, rowText: 'fix the login bug' })).toEqual({
      kind: 'defer', reasonKey: 'advisor.verdict.defer',
    })
  })

  it('defers a question without any probe token', () => {
    expect(advise({ ...base, rowText: 'use vitest instead?' })).toEqual({
      kind: 'defer', reasonKey: 'advisor.verdict.defer',
    })
  })

  it('defers a probe question over the length cap', () => {
    expect(advise({ ...base, rowText: `${'a'.repeat(75)} what?` })).toEqual({
      kind: 'defer', reasonKey: 'advisor.verdict.defer',
    })
  })

  it('classifies a status probe exactly at the length cap', () => {
    expect(advise({ ...base, rowText: `${'a'.repeat(74)} what?` })).toEqual({
      kind: 'status', reasonKey: 'advisor.verdict.status',
    })
  })

  it('defers an attachment-only row without text', () => {
    expect(advise({ ...base, rowText: '' })).toEqual({
      kind: 'defer', reasonKey: 'advisor.verdict.defer',
    })
  })
})

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
