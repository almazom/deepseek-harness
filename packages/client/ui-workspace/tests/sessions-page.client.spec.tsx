// @vitest-environment jsdom
/**
 * The Sessions page surface (SlotTestRuntime, real apply, real SessionsPage):
 * the keyed `main` entry under key `sessions` renders the locale page title
 * and the mounted browsing core, a session-row click opens the Session, the
 * page's directory-flow hole is declared and stays affordance-free while
 * unoccupied, and the `sidebar.panellist` row advertises the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkspaceBrowserInjected } from '../src/client/contract/slots.ts'

usePinnedBrowserLanguages('zh-CN')

const CURRENT = 's-current' as SessionId
const OTHER = 's-other' as SessionId

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

async function createRuntime(): Promise<{ runtime: SlotTestRuntime; layout: { selectPanel: ReturnType<typeof vi.fn> } }> {
  const runtime = await SlotTestRuntime.create()
  const layout = {
    beginNavigation: vi.fn(() => new AbortController().signal),
    toggleSidebar: vi.fn(),
    selectPanel: vi.fn(),
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  }
  runtime.ctx.provide('layout', layout)
  runtime.releaseWorkspaceSource()
  Object.assign(new TestRemote(runtime.ctx), { directoryPicker: {} })
  runtime.ctx.provide('remote.directoryPicker', {} as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  return { runtime, layout }
}

/** Seed one workspace with a current row and a second, not-selected row. */
async function seedSessions(runtime: SlotTestRuntime): Promise<void> {
  await runtime.sessions.add({
    id: CURRENT,
    summary: { title: 'Свежая', displayTitle: 'Свежая', cwd: '/w/alpha', updatedAt: Date.now() },
  }, { current: true })
  await runtime.sessions.add({
    id: OTHER,
    summary: { title: 'Старая', displayTitle: 'Старая', cwd: '/w/alpha', updatedAt: Date.now() - 86_400_000 },
  }, { current: false })
  await runtime.workspaces.update((draft) => {
    draft.items = [{
      workspaceId: 'w1' as WorkspaceId, title: 'alpha', path: '/w/alpha',
      sessionIds: [CURRENT, OTHER], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }] as never
  })
}

type FrameProps = PropsRuntime<'root'> & PropsRenderSlots<'main' | 'sidebar.panellist'>
/** Test frame: the page panel plus the panel-list row (registry-level entries render both). */
function Frame({ renderSlot }: FrameProps) {
  return (
    <>
      <nav>{renderSlot('sidebar.panellist', { size: 16, active: false })}</nav>
      <main>{renderSlot('main', {}, { entryKey: 'sessions' })}</main>
    </>
  )
}

async function mountPage(runtime: SlotTestRuntime) {
  await runtime.root.declare({
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  }, Frame)
  await runtime.mount({ inject: [...inject], apply })
  return runtime.renderRoot()
}

describe('sessions page entry', () => {
  it('registers the keyed main entry with its directory-flow hole and the addressing panel row', async () => {
    const { runtime } = await createRuntime()
    await seedSessions(runtime)
    await mountPage(runtime)
    const mainEntries = runtime.slots.entries('main')
    expect(mainEntries).toHaveLength(1)
    expect(mainEntries[0]!.options.key).toBe('sessions')
    // The page entry declared its hole (declaration = render authorization).
    expect(runtime.slots.spec('sessions.page.directoryFlow')).toMatchObject({ kind: 'single', scope: 'root' })
    const panelEntries = runtime.slots.entriesOfSlot('sidebar.panellist')
    expect(panelEntries).toHaveLength(1)
    expect(panelEntries[0]!.options.id).toBe('sessions')
    expect(panelEntries[0]!.options.order).toBe(10)
    expect(resolveSlotLabel(panelEntries[0]!.options.label)).toBe('会话')
    await runtime.dispose()
  })

  it('renders the locale page title and mounts the browsing core', async () => {
    const { runtime } = await createRuntime()
    await seedSessions(runtime)
    const view = await mountPage(runtime)
    expect(view.getByRole('heading', { level: 1, name: '会话' })).toBeTruthy()
    // The core's grouped list is mounted with the seeded rows.
    expect(view.getByText('Свежая')).toBeTruthy()
    expect(view.getByText('Старая')).toBeTruthy()
    expect(view.getByText('alpha')).toBeTruthy()
    await runtime.dispose()
  })

  it('opens the session when a session row is clicked', async () => {
    const { runtime, layout } = await createRuntime()
    await seedSessions(runtime)
    const view = await mountPage(runtime)
    fireEvent.click(view.getByText('Старая').closest('[role="treeitem"]')!)
    await waitFor(() => {
      expect(runtime.sessions.list.getSnapshot().current).toBe(OTHER)
    })
    // Opening a session from the page also returns the frame to the Conversation.
    expect(layout.selectPanel).toHaveBeenCalledWith(null)
    await runtime.dispose()
  })

  it('hides the add-workspace affordance while the page directory-flow hole is unoccupied', async () => {
    const { runtime } = await createRuntime()
    await seedSessions(runtime)
    const view = await mountPage(runtime)
    // Nothing to add with, so the page header offers no dead button.
    expect(view.queryByRole('button', { name: '添加工作区' })).toBeNull()
    const page = runtime.slots.entries('main')[0]!.inject as () => WorkspaceBrowserInjected
    expect(page().hooks.directoryFlow.getSnapshot()).toBe(false)
    await runtime.dispose()
  })
})
