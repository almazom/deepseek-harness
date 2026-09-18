// @vitest-environment jsdom
/** FontSizeRow behavior: value display, direct numeric input, arrow clicks
 * drive setFontSize, bound-value arrows disable, display follows the store
 * mirror, arrow-key stepping, blur clamping. */
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { FontSizeRow } from '../src/client/FontSizeRow.tsx'
import type { FontSizeRowComponentProps } from '../src/client/FontSizeRow.tsx'
import { createFontSizeRowStore } from '../src/client/settings-store.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)

const COPY: Record<string, string> = {
  'fontSize.title': 'Font size',
  'fontSize.description': 'Only affects conversation content',
  'fontSize.increase': 'Increase font size',
  'fontSize.decrease': 'Decrease font size',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  })
  return bindSnapshotSelector(store)
}

type AttentionSnapshot = Parameters<Parameters<FontSizeRowComponentProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: FontSizeRowComponentProps['useSessionPendingInteraction'] = selector => selector(noAttention)

function mount(fontSize = 14) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createFontSizeRowStore().create()
  store.actions.sync(fontSize, 0)
  const setFontSize = vi.fn()
  const props: FontSizeRowComponentProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction,
    usePanelInfo, useResource,
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    setFontSize,
  }
  render(<FontSizeRow {...props} />)
  return { store, setFontSize }
}

const arrow = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement

const input = (): HTMLInputElement =>
  screen.getByRole('spinbutton', { name: 'Font size' }) as HTMLInputElement

describe('FontSizeRow', () => {
  it('renders the title and the current size with both arrows enabled mid-range', () => {
    mount(14)
    expect(screen.getByText('Font size')).toBeDefined()
    expect(screen.getByText('Only affects conversation content')).toBeDefined()
    expect(input().value).toBe('14')
    expect(arrow('Increase font size').disabled).toBe(false)
    expect(arrow('Decrease font size').disabled).toBe(false)
  })

  it('arrow clicks step by 1; display follows the store mirror, not the click echo', () => {
    const b = mount(14)
    fireEvent.click(arrow('Increase font size'))
    expect(b.setFontSize).toHaveBeenCalledWith(15)
    // No store write yet: the display is unchanged.
    expect(input().value).toBe('14')
    act(() => { b.store.actions.sync(15, 1) })
    expect(input().value).toBe('15')
    fireEvent.click(arrow('Decrease font size'))
    expect(b.setFontSize).toHaveBeenCalledWith(14)
  })

  it('typing a valid value calls setFontSize directly', () => {
    const b = mount(14)
    fireEvent.change(input(), { target: { value: '16' } })
    expect(b.setFontSize).toHaveBeenCalledWith(16)
  })

  it('out-of-range intermediates stay in the draft and never snap the controlled value back', () => {
    const b = mount(14)
    // Typing "13": the intermediate "1" is out of range — the raw text must
    // survive in the field (no controlled revert), only the final commit fires.
    fireEvent.change(input(), { target: { value: '1' } })
    expect(b.setFontSize).not.toHaveBeenCalled()
    expect(input().value).toBe('1')
    fireEvent.change(input(), { target: { value: '13' } })
    expect(b.setFontSize).toHaveBeenCalledWith(13)
    expect(input().value).toBe('13')
  })

  it('ArrowUp/ArrowDown on the input step by 1 within bounds', () => {
    const b = mount(14)
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(b.setFontSize).toHaveBeenCalledWith(15)
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(b.setFontSize).toHaveBeenCalledWith(13)
  })

  it('blur commits clamped values; an invalid draft restores the persisted value', () => {
    const b = mount(14)
    fireEvent.change(input(), { target: { value: '99' } })
    fireEvent.blur(input())
    expect(b.setFontSize).toHaveBeenLastCalledWith(17)
    // Cleared field + blur: the persisted value wins (no drop to the minimum).
    // oxlint-disable-next-line typescript/unbound-method -- the IDL value setter requires the element receiver, applied explicitly below
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    Reflect.apply(nativeSetter, input(), [''])
    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.blur(input())
    expect(b.setFontSize).not.toHaveBeenCalledWith(12)
    expect(input().value).toBe('14')
  })

  it('Enter commits the draft; an arrow-button click discards it and follows the store', () => {
    const b = mount(14)
    // Enter commits an in-range draft.
    fireEvent.change(input(), { target: { value: '16' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(b.setFontSize).toHaveBeenLastCalledWith(16)
    // A stale out-of-range draft is discarded by an arrow-button click: the
    // display follows the store value, never the stale text.
    fireEvent.change(input(), { target: { value: '9' } })
    expect(input().value).toBe('9')
    fireEvent.click(arrow('Increase font size'))
    expect(b.setFontSize).toHaveBeenLastCalledWith(15)
    expect(input().value).toBe('14')
  })

  it('disables the outward arrow at each bound', () => {
    mount(17)
    expect(arrow('Increase font size').disabled).toBe(true)
    expect(arrow('Decrease font size').disabled).toBe(false)
    cleanup()
    mount(12)
    expect(arrow('Increase font size').disabled).toBe(false)
    expect(arrow('Decrease font size').disabled).toBe(true)
  })
})
