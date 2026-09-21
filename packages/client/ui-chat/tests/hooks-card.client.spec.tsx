// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ConversationMatch, ConversationNodeContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { zh } from '../src/client/locale.ts'
import { HooksNodeView } from '../src/client/chat/HooksCard.tsx'
import { hooksDefinition, type HooksState } from '../src/client/conversation-nodes/hooks.ts'

const t = makeTranslate(zh, commonZh)

afterEach(cleanup)

const ev = (type: string, data: object) => ({ type, data, seq: 0, surfaceOp: 'append' }) as never

const startMatch = {
  event: ev('turn/start', { turn: 3 }),
  role: 'start',
  location: { kind: 'session' },
} as unknown as ConversationMatch & { role: 'start' }

function run(events: readonly [string, object][]): HooksState {
  let state = hooksDefinition.start({} as ConversationNodeContext<HooksState>, startMatch, undefined as never)
  for (const [type, data] of events) {
    state = hooksDefinition.update(
      { state } as unknown as ConversationNodeContext<HooksState> & { readonly state: HooksState },
      { event: ev(type, data), role: 'update', location: { kind: 'session' } } as unknown as ConversationMatch,
    )
  }
  return state
}

function viewNode(state: HooksState) {
  return hooksDefinition.buildViewNode({
    state,
    startSeq: 7,
    matches: [],
    current: new Map(),
  } as unknown as ConversationNodeContext<HooksState>)
}

describe('hooks card projection', () => {
  it('matches hook definitions inside a turn and pairs results by point and handler', () => {
    expect(hooksDefinition.match(ev('turn/start', { turn: 3 }))).toMatchObject({ id: '3', role: 'start' })
    expect(hooksDefinition.match(ev('hook/invoked', { turn: 3, point: 'PreToolUse', handlerId: 'h', dialect: 'x' })))
      .toMatchObject({ id: '3', role: 'update' })
    expect(hooksDefinition.match(ev('assistant/message', { turn: 3 }))).toBeNull()

    const state = run([
      ['hook/invoked', { turn: 3, point: 'PreToolUse', handlerId: 'h1', dialect: 'claude-code' }],
      ['hook/invoked', { turn: 3, point: 'PreToolUse', handlerId: 'h2', dialect: 'claude-code' }],
      ['hook/result', { turn: 3, point: 'PreToolUse', handlerId: 'h2', decision: 'stop', exitCode: 2, durationMs: 250 }],
      ['hook/result', { turn: 3, point: 'PreToolUse', handlerId: 'h1', decision: 'pass', durationMs: 1200 }],
    ])
    expect(state.runs).toEqual([
      { point: 'PreToolUse', handlerId: 'h1', dialect: 'claude-code', decision: 'pass', durationMs: 1200 },
      { point: 'PreToolUse', handlerId: 'h2', dialect: 'claude-code', decision: 'stop', exitCode: 2, durationMs: 250 },
    ])
  })

  it('renders the card only for turns with hook runs, pending runs included', () => {
    const empty = run([])
    expect(viewNode(empty)).toBeNull()

    const pending = run([
      ['hook/invoked', { turn: 3, point: 'SessionStart', handlerId: 'warm', dialect: 'claude-code' }],
    ])
    const node = viewNode(pending)
    expect(node).not.toBeNull()
    expect(node?.data.hooks).toEqual([{ point: 'SessionStart', handlerId: 'warm', dialect: 'claude-code' }])
  })
})

describe('HooksNodeView', () => {
  it('renders the telemetry card with points, handlers, decisions, and durations', () => {
    render(
      <HooksNodeView
        {...({ t } as never)}
        {...{
          node: {
            key: 'hooks/3',
            kind: 'hooks',
            id: '3',
            target: 'chat',
            anchorSeq: 7,
            location: { kind: 'session' },
            visibility: 'visible',
            data: {
              hooks: [
                { point: 'PreToolUse', handlerId: 'gate', decision: 'pass', durationMs: 1200 },
                { point: 'PostToolUse', handlerId: 'mem', decision: 'stop', exitCode: 2, durationMs: 250 },
              ],
            },
          },
        } as never}
      />,
    )
    expect(screen.getByRole('group', { name: '钩子遥测' }).hasAttribute('data-hooks-card')).toBe(true)
    expect(screen.getByText('钩子')).toBeTruthy()
    expect(screen.getByText('PreToolUse')).toBeTruthy()
    expect(screen.getByText('gate')).toBeTruthy()
    expect(screen.getByText('1200ms')).toBeTruthy()
    expect(screen.getByText('250ms')).toBeTruthy()
    // Decisions render as the durable data values they are (pass/stop), not locale copy.
    expect(screen.getByText('stop')).toBeTruthy()
    expect(screen.getByText('pass')).toBeTruthy()
  })
})
