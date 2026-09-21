// @vitest-environment jsdom
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotTestRuntime, stubSettingsScope, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationSessionHeader } from '../src/client/skeleton/ConversationSession.tsx'
import { en } from '../src/client/locales.ts'

usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId

const t = (key: string) => (en as unknown as Record<string, string>)[key] ?? key

function sessionFakeFor() {
  return {
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    cancel: vi.fn<ISession['cancel']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    rename: vi.fn<ISession['rename']>(() =>
      Promise.resolve({ ok: true, value: { title: 'Renamed', seq: 1 as never } })),
  }
}

/** Assembled runtime exposing the mounted header inject (verb-level coverage). */
async function bench(sessionFake: ReturnType<typeof sessionFakeFor>) {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  runtime.ctx.provide('uiWorkspace', {
    openWorkspace: async (_workspaceId: WorkspaceId, beforeOpen: (id: SessionId) => void) => {
      beforeOpen(ROOT)
      runtime.sessions.open(ROOT)
    },
    openSession: (id: SessionId) => { runtime.sessions.open(id) },
  } as never)
  // The header inject reads the layout face: the narrow fact backs the back
  // affordance and selectPanel leaves the selected main panel.
  runtime.ctx.provide('layout', {
    beginNavigation: vi.fn(() => new AbortController().signal),
    toggleSidebar: vi.fn(),
    selectPanel: vi.fn(),
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
    narrow: createSnapshotStore<boolean>(false),
  })
  await runtime.sessions.add({
    id: ROOT,
    summary: { title: 'One', displayTitle: 'One', cwd: '/proj' },
    session: sessionFake,
  }, { current: true })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.root.declare({ 'main': { kind: 'keyed', scope: 'root' } }, (_props: { renderSlot?: unknown }) => null)
  const feature = await runtime.mount({ inject: [...inject], apply })
  runtime.renderRoot()
  const headerEntry = runtime.slots.entries('conversation.session.header')[0]!
  return { runtime, feature, headerEntry, sessionFake }
}

/** Direct component mount with fake stores (presentation-level coverage). */
function headerHarness(overrides: Partial<Parameters<typeof ConversationSessionHeader>[0]> = {}) {
  const listState = {
    byId: {
      [ROOT]: { id: ROOT, title: 'One', displayTitle: 'One', origin: 'user', parentId: undefined },
    },
    current: ROOT,
  } as unknown as SessionListState
  const storeState = { view: undefined }
  const props = {
    sessionId: ROOT,
    useSession: ((selector: (s: { blank: boolean }) => unknown) => selector({ blank: false })) as never,
    useProjection: (() => undefined) as never,
    useSessions: ((selector: (s: SessionListState) => unknown) => selector(listState)) as never,
    useWorkspaces: ((selector: (s: object) => unknown) => selector({ items: [] })) as never,
    SessionProvider: (({ children }: { children?: import('react').ReactNode }) => children ?? null) as never,
    useConversation: ((selector: (s: object) => unknown) => selector({})) as never,
    useChat: ((selector: (s: object) => unknown) => selector({})) as never,
    useTrajectory: ((selector: (s: object) => unknown) => selector({})) as never,
    useResource: (() => undefined) as never,
    usePanelInfo: (() => ({ activePanelId: null })) as never,
    useSessionPendingInteraction: (() => new Map()) as never,
    useInput: ((selector: (s: object) => unknown) => selector({})) as never,
    inputActions: {} as never,
    useConversationViews: ((selector: (s: readonly unknown[]) => unknown) => selector([])) as never,
    useNarrow: ((selector: (narrow: boolean) => unknown) => selector(false)) as never,
    useStore: ((selector: (s: typeof storeState) => unknown) => selector(storeState)) as never,
    actions: {} as never,
    renderSlot: (() => null) as never,
    open: vi.fn(),
    rename: vi.fn(() => Promise.resolve()),
    selectView: vi.fn(),
    selectPanel: vi.fn(),
    t,
    ...overrides,
  }
  render(<ConversationSessionHeader {...props} />)
  return props
}

describe('session header rename', () => {
  it('click-to-rename persists through the session rename verb', async () => {
    const props = headerHarness()
    onTestFinished(cleanup)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('session.rename.aria') })) })
    const input = screen.getByRole('textbox', { name: t('session.rename.aria') })
    expect((input as HTMLInputElement).value).toBe('One')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Renamed' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(props.rename).toHaveBeenCalledWith('Renamed')
    // Committed rename closes the editor back to the title button (the fixture list is static,
    // so the crumb still reads the old display title here; the controller relabels it live).
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'One' })).not.toBeNull()
  })

  it('a rejected rename keeps the editor and surfaces the error', async () => {
    const props = headerHarness({ rename: vi.fn(() => Promise.reject(new Error('denied'))) })
    onTestFinished(cleanup)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('session.rename.aria') })) })
    const input = screen.getByRole('textbox')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Renamed' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(props.rename).toHaveBeenCalledWith('Renamed')
    expect(screen.getByRole('alert').textContent).toBe('denied')
    expect(screen.queryByRole('textbox')).not.toBeNull()
  })

  it('escape cancels without calling the verb', async () => {
    const props = headerHarness()
    onTestFinished(cleanup)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t('session.rename.aria') })) })
    const input = screen.getByRole('textbox')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Discarded' } })
      fireEvent.keyDown(input, { key: 'Escape' })
    })
    expect(props.rename).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'One' })).not.toBeNull()
  })

  it('a subagent session header offers no rename affordance', () => {
    // The rename verb targets the last ancestry crumb and subagent crumbs are
    // excluded from hosting the editor, so the pencil must be absent there —
    // otherwise clicking it opens a dead-end state with no input.
    const listState = {
      byId: {
        [ROOT]: { id: ROOT, title: 'Sub', displayTitle: 'Sub', origin: 'subagent', parentId: 'parent-1' },
      },
      current: ROOT,
    } as unknown as SessionListState
    headerHarness({ useSessions: ((selector: (s: SessionListState) => unknown) => selector(listState)) as never })
    onTestFinished(cleanup)
    expect(screen.queryByRole('button', { name: t('session.rename.aria') })).toBeNull()
  })

  it('the assembled header inject renames through ISession.rename and propagates failures', async () => {
    const sessionFake = sessionFakeFor()
    const b = await bench(sessionFake)
    onTestFinished(() => { void b.runtime.dispose() })
    type HeaderInject = { rename: (title: string) => Promise<void> }
    const injected = (b.headerEntry.inject as unknown as (id: SessionId) => HeaderInject)(ROOT)
    await expect(injected.rename('Renamed')).resolves.toBeUndefined()
    expect(sessionFake.rename).toHaveBeenCalledWith('Renamed')
    sessionFake.rename.mockRejectedValueOnce(new Error('blank title'))
    await expect(injected.rename('   ')).rejects.toThrow('blank title')
    await b.runtime.dispose()
  })
})
