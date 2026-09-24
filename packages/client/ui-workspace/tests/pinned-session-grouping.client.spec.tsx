// @vitest-environment jsdom
/**
 * Pinned sessions on the assembled browser (SlotTestRuntime, real apply, real
 * WorkspaceBrowser): row menu Pin moves a row into the localized Pinned
 * section above the Today/Earlier buckets; Unpin returns it; the pin set rides
 * the persisted viewing store, so a fresh mount re-reads it from localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'

usePinnedBrowserLanguages('zh-CN')

const TODAY = 's-today' as SessionId
const OLD_PINNED = 's-old-pin' as SessionId
const OLD_LATE = 's-old-late' as SessionId

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

async function createRuntime(): Promise<SlotTestRuntime> {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('layout', { selectPanel: vi.fn(), narrow: createSnapshotStore(false) })
  runtime.releaseWorkspaceSource()
  Object.assign(new TestRemote(runtime.ctx), { directoryPicker: {} })
  runtime.ctx.provide('remote.directoryPicker', {} as never)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  return runtime
}

type FrameProps = PropsRenderSlots<'sidebar.workspaces'>
function SidebarFrame({ renderSlot }: FrameProps) {
  return <>{renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}</>
}

/** Seed one workspace with a today row and two three-days-old rows; today is current (auto-expands). */
async function seedSessions(runtime: SlotTestRuntime): Promise<void> {
  const threeDaysAgo = Date.now() - 3 * 86_400_000
  await runtime.sessions.add({
    id: TODAY,
    summary: { title: 'Свежая', displayTitle: 'Свежая', cwd: '/w/alpha', updatedAt: Date.now() },
  }, { current: true })
  await runtime.sessions.add({
    id: OLD_PINNED,
    summary: { title: 'Старая-пин', displayTitle: 'Старая-пин', cwd: '/w/alpha', updatedAt: threeDaysAgo } as never,
  })
  await runtime.sessions.add({
    id: OLD_LATE,
    summary: { title: 'Старая-поздняя', displayTitle: 'Старая-поздняя', cwd: '/w/alpha', updatedAt: threeDaysAgo } as never,
  })
  await runtime.workspaces.update((draft) => {
    draft.items = [{
      workspaceId: 'w1' as WorkspaceId, title: 'alpha', path: '/w/alpha',
      sessionIds: [TODAY, OLD_PINNED, OLD_LATE], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }] as never
  })
}

async function mountBrowser(runtime: SlotTestRuntime) {
  await runtime.root.declare(
    { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
    SidebarFrame as never,
  )
  await runtime.mount({ inject: [...inject], apply })
  return runtime.renderRoot()
}

function menuButton(view: ReturnType<SlotTestRuntime['renderRoot']>, rowTitle: string) {
  const row = view.getByText(rowTitle).closest('[role="treeitem"]')!
  return within(row as HTMLElement).getByLabelText(`会话“${rowTitle}”的操作`)
}

describe('pinned session grouping', () => {
  it('pin moves a row into Pinned above Today and Earlier; unpin returns it', async () => {
    const runtime = await createRuntime()
    await seedSessions(runtime)
    const view = await mountBrowser(runtime)
    await view.findByText('Старая-пин').catch(() => { view.debug(undefined, 20000) })

    // Pin the older row from its row menu.
    fireEvent.click(menuButton(view, 'Старая-пин'))
    fireEvent.click(view.getByRole('menuitem', { name: '置顶会话', hidden: true }))

    const pinnedHeading = await view.findByText('已置顶')
    expect(pinnedHeading.getAttribute('data-session-section')).toBe('pinned')
    // Pinned sits before Today in document order, and holds the pinned row.
    const todayHeading = view.getByText('今天')
    expect(pinnedHeading.compareDocumentPosition(todayHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const pinnedZone = pinnedHeading.parentElement!
    expect(within(pinnedZone).getByText('Старая-пин')).toBeTruthy()
    // The today row stays in the Today section.
    expect(within(todayHeading.parentElement!).getByText('Свежая')).toBeTruthy()

    // Unpin returns the row to its time section; the Pinned heading disappears.
    fireEvent.click(menuButton(view, 'Старая-пин'))
    fireEvent.click(view.getByRole('menuitem', { name: '取消置顶', hidden: true }))
    await view.findByText('Старая-пин')
    expect(view.queryByText('已置顶')).toBeNull()
    await runtime.dispose()
  })

  it('the pin set survives a reload through the persisted store', async () => {
    const runtime = await createRuntime()
    await seedSessions(runtime)
    const view = await mountBrowser(runtime)
    await view.findByText('Старая-пин')

    fireEvent.click(menuButton(view, 'Старая-пин'))
    fireEvent.click(view.getByRole('menuitem', { name: '置顶会话', hidden: true }))
    await view.findByText('已置顶')

    // Reload proof 1: the persisted seam carries the pinned id.
    const persisted = JSON.parse(localStorage.getItem('dsh.workspace.view.v7')!) as { pinnedIds: string[] }
    expect(persisted.pinnedIds).toContain(OLD_PINNED)

    // Reload proof 2: a second browser instance (own runtime, same jsdom
    // origin) hydrates the pinned set from the same persisted key. Queries
    // scope to the second surface because the first one stays mounted.
    const reloaded = await createRuntime()
    await seedSessions(reloaded)
    await mountBrowser(reloaded)
    const secondSurface = document.querySelectorAll('[data-slot="sidebar.workspaces"]')[1] as HTMLElement
    const heading2 = await within(secondSurface).findByText('已置顶')
    expect(within(heading2.parentElement!).getByText('Старая-пин')).toBeTruthy()
    await reloaded.dispose()
  })

  it('a pinned row stays visible in a collapsed group past the ordinary-row limit', async () => {
    const runtime = await createRuntime()
    const threeDaysAgo = Date.now() - 3 * 86_400_000
    const sessionIds: string[] = []
    for (let index = 0; index < 7; index += 1) {
      const id = `s-deep-${index}` as SessionId
      await runtime.sessions.add({
        id,
        summary: { title: `Глубокая-${index}`, displayTitle: `Глубокая-${index}`, cwd: '/w/alpha', updatedAt: threeDaysAgo } as never,
      })
      sessionIds.push(id)
    }
    await runtime.workspaces.update((draft) => {
      draft.items = [{
        workspaceId: 'w1' as WorkspaceId, title: 'alpha', path: '/w/alpha',
        sessionIds, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }] as never
    })
    // No current session in the group, so the row collapse applies; s-deep-6
    // sits past the five-row cut. The pinned set is seeded the way a previous
    // run would have persisted it (whole-value v6 payload).
    localStorage.setItem('dsh.workspace.view.v7', JSON.stringify({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrderByAccount: {},
      sessionUpdatedAtByAccount: {},
      pinnedIds: ['s-deep-6'],
    }))
    const view = await mountBrowser(runtime)
    const pinnedHeading = await view.findByText('已置顶')
    expect(within(pinnedHeading.parentElement!).getByText('Глубокая-6')).toBeTruthy()
    // The overflow count excludes the pinned row: 6 ordinary - 5 visible = 1.
    expect(view.getByRole('button', { name: '展开其余 1 个会话' })).not.toBeNull()
    await runtime.dispose()
  })
})
