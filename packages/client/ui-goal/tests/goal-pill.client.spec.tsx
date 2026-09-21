// @vitest-environment jsdom

import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoalSnapshot } from '@deepseek-ai/dsh-goal/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { GoalBar } from '../src/client/GoalBar.tsx'
import type { GoalBarActions } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'

const t: Parameters<typeof GoalBar>[0]['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

function makeGoal(over: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    id: 'g1' as GoalSnapshot['id'],
    revision: 1,
    objective: 'Ship the redesign',
    phase: 'active',
    maxGoalRounds: 4,
    ...over,
  }
}

function makeActions(): GoalBarActions {
  return {
    onEdit: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
    onPause: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
    onResume: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
    onClear: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  }
}

describe('GoalBar pill mode', () => {
  it('active + disarmed renders the pill with the operator-go label and reachable actions', () => {
    const actions = makeActions()
    const { container } = render(<GoalBar goal={makeGoal()} activation="disarmed" {...actions} t={t} />)
    expect(container.querySelector('[data-goal-pill]')).not.toBeNull()
    expect(screen.getByText('未运行的目标')).toBeTruthy()
    const resume = screen.getByRole('button', { name: '恢复目标' })
    fireEvent.click(resume)
    expect(actions.onResume).toHaveBeenCalledTimes(1)
    // Every strip action stays reachable in pill mode.
    expect(screen.getByRole('button', { name: '编辑目标' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清除目标' })).toBeTruthy()
  })

  it('active + armed and paused goals keep the bar (no pill attribute)', () => {
    const actions = makeActions()
    const armed = render(<GoalBar goal={makeGoal()} activation="armed" {...actions} t={t} />)
    expect(armed.container.querySelector('[data-goal-pill]')).toBeNull()
    expect(screen.getByText('进行中的目标')).toBeTruthy()
    cleanup()

    const paused = render(<GoalBar goal={makeGoal({ phase: 'paused' })} {...actions} t={t} />)
    expect(paused.container.querySelector('[data-goal-pill]')).toBeNull()
    expect(screen.getByText('已暂停的目标')).toBeTruthy()
  })

  it('blocked and complete goals never render the pill', () => {
    const actions = makeActions()
    const blocked = render(<GoalBar goal={makeGoal({ phase: 'blocked' })} {...actions} t={t} />)
    expect(blocked.container.querySelector('[data-goal-pill]')).toBeNull()
    cleanup()

    const complete = render(<GoalBar goal={makeGoal({ phase: 'complete' })} {...actions} t={t} />)
    expect(complete.container.querySelector('[data-goal-pill]')).toBeNull()
  })
})
