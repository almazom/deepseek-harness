/**
 * The full-page Sessions surface, the `main` slot's `sessions` key: a title
 * header row with the landing counts line, and the same browsing core the
 * sidebar region mounts (SessionBrowserCore — search results, grouped/flat
 * lists, workspace and session dialogs) at full width. The page owns its
 * browsing chrome — the search field, the shared ViewOptionsMenu
 * grouping/sorting menu, and the New Session pick flow — plus the
 * search-query state, its own directory-flow hole
 * (`sessions.page.directoryFlow`), and the counts line; workspaces and
 * sessions derive from the same framework data the core renders. New Session
 * opens the pick flow over existing workspaces; creating a workspace inside
 * the flow needs a directory-flow occupant.
 */
import { useMemo, useRef, useState } from 'react'
import {
  IconCloseFill14, IconListPenOutline16, IconProjectAddOutline16,
  IconSearchOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionsPageProps } from '../contract/slots.ts'
import { sanitizeSearchQuery, SEARCH_QUERY_MAX_CODE_UNITS, ViewOptionsMenu } from './WorkspaceBrowser.tsx'
import { deriveFlat } from '../tree.ts'
import { WorkspacePickFlow } from '../WorkspacePicker.tsx'
import { SessionBrowserCore } from './SessionBrowserCore.tsx'
import css from './SessionsPage.module.css'

/**
 * Sidebar panel-list glyph for the Sessions row: the row icon in both the
 * expanded label row and the collapsed rail (the row supplies `size` and
 * owns the active styling around the glyph).
 * @param props - the panel row's icon presentation share.
 * @returns the glyph element.
 */
export function SessionsPanelGlyph({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <IconListPenOutline16 size={size} />
}

/**
 * Render the full-width Sessions page.
 * @param props - composed slot props (keyed main runtime seat, the page's
 *   directory-flow hole, the shared viewing store, injected Host actions,
 *   and the locale seat).
 * @returns the page element tree.
 */
export function SessionsPage({
  usePanelInfo,
  useSessions,
  useSessionPendingInteraction,
  useWorkspaces,
  useStore,
  actions,
  startSession,
  open,
  renameSession,
  forkSession,
  renameWorkspace,
  deleteWorkspace,
  insertWorkspaceBefore,
  archiveSession,
  insertSessionBefore,
  createWorkspace,
  searchSessions,
  searchResultLimit,
  useDirectoryFlow,
  useHostInfo,
  renderSlot,
  t,
}: SessionsPageProps) {
  const home = useHostInfo(info => info.home)
  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const workspaceStreamState = useWorkspaces(state => state.state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  // Live occupancy of the page's directory-flow hole (the same source the
  // flow reads): a composition without a picking affordance can add nothing.
  const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
  const groupBy = useStore(s => s.groupBy)
  const orderBy = useStore(s => s.orderBy)
  const groupExpansion = useStore(s => s.groupExpansion)
  const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
  const sessionUpdatedAtByAccount = useStore(s => s.sessionUpdatedAtByAccount)
  const pinnedIds = useStore(s => s.pinnedIds)
  // The counts line reads the same framework data the mounted core renders:
  // workspaces from the global snapshot, sessions as the visible top-level
  // rows the core derives (deriveFlat — archived, subagent-origin, and
  // non-current blank rows excluded; the grouped and flat bodies show the
  // same set). A pure derivation over hook data, not a second subscription.
  const pendingInteractions = useSessionPendingInteraction(s => s)
  const sessions = useSessions(s => s)
  const workspaceCount = workspaces.length
  const sessionCount = useMemo(
    () => deriveFlat(sessions, archivedSessionIds, pendingInteractions).length,
    [sessions, archivedSessionIds, pendingInteractions],
  )
  // The query and expansion state outlive the core's body (the sidebar region
  // keeps the same contract): one owner holds the in-progress filter while
  // search results mount and clear in the core. The core clears both on a
  // search-result selection; the page's own search field rides in with the
  // chrome card, so only the setter is consumed here.
  const [query, setQuery] = useState('')
  const [, setSearchExpanded] = useState(false)
  const normalizedQuery = sanitizeSearchQuery(query).trim()
  // Header ＋ opens the picker menu; the menu anchors on this button.
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const wsPlusRef = useRef<HTMLButtonElement>(null)

  return (
    <div className={css.page}>
      <div className={css.pageHeader}>
        <div className={css.pageHeading}>
          <h1 className={css.pageTitle}>{t('panel.sessions')}</h1>
          {/* Each count keeps its own localized unit string, joined by a
              plain separator, so zh and en both read naturally. */}
          <p className={css.pageCounts}>
            <span>{t('sessions.counts.workspaces', { n: workspaceCount })}</span>
            {' · '}
            <span>{t('sessions.counts.sessions', { n: sessionCount })}</span>
          </p>
        </div>
        {/* The page owns its browsing chrome: an always-visible search field
            and the same grouping/sorting menu the sidebar header mounts, so
            the landing surface is self-sufficient at every frame width. */}
        <div className={css.pageSearch}>
          <IconSearchOutline16 size={14} />
          <input
            className={css.searchInput}
            type="text"
            placeholder={t('search.placeholder')}
            aria-label={t('search.sessions.aria')}
            maxLength={SEARCH_QUERY_MAX_CODE_UNITS}
            value={query}
            onChange={(e) => { setQuery(sanitizeSearchQuery(e.target.value)) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
          />
          {query !== '' && (
            <button
              type="button"
              className={css.clearButton}
              aria-label={t('search.clear')}
              onClick={() => { setQuery('') }}
            >
              <IconCloseFill14 />
            </button>
          )}
        </div>
        <div className={css.pageActions}>
          <ViewOptionsMenu
            groupBy={groupBy}
            orderBy={orderBy}
            onGroupPick={(mode) => { actions.setGroupBy(mode) }}
            onOrderPick={(mode) => { actions.setOrderBy(mode) }}
            t={t}
          />
          {/* New Session is the page's primary affordance: the picker lists
              existing workspaces (creating needs a directory flow, so the
              header shows the button whenever either path is available). */}
          {(workspaceCount > 0 || directoryFlowAvailable) && (
            <Tooltip label={t('session.new')} side="bottom" delayMs={500}>
              <button
                ref={wsPlusRef}
                type="button"
                className={css.newSessionButton}
                aria-label={t('session.new')}
                onClick={() => { setWsPickerOpen(v => !v) }}
              >
                <IconProjectAddOutline16 size={14} />
                <span>{t('session.new')}</span>
              </button>
            </Tooltip>
          )}
        </div>
        {/* Pick flow + its error dialog (same package — direct composition). */}
        <WorkspacePickFlow
          t={t}
          open={wsPickerOpen}
          anchorRef={wsPlusRef}
          useWorkspaces={useWorkspaces}
          createWorkspace={createWorkspace}
          useDirectoryFlow={useDirectoryFlow}
          renderDirectoryFlow={owner => renderSlot('sessions.page.directoryFlow', owner)}
          side="bottom"
          onPick={(workspaceId) => {
            setWsPickerOpen(false)
            startSession(workspaceId)
          }}
          onClose={() => { setWsPickerOpen(false) }}
        />
      </div>

      {/* Full-bleed body: the browsing core owns its own scroll region and
          spacing, identical to the sidebar region's list area. */}
      <div className={css.pageBody}>
        <SessionBrowserCore
          wide
          normalizedQuery={normalizedQuery}
          onQueryChange={setQuery}
          onSearchExpandedChange={setSearchExpanded}
          home={home}
          usePanelInfo={usePanelInfo}
          useSessions={useSessions}
          useSessionPendingInteraction={useSessionPendingInteraction}
          actions={actions}
          workspaces={workspaces}
          workspacePhase={workspacePhase}
          workspaceStreamState={workspaceStreamState}
          archivedSessionIds={archivedSessionIds}
          groupBy={groupBy}
          orderBy={orderBy}
          groupExpansion={groupExpansion}
          sessionOrderByAccount={sessionOrderByAccount}
          sessionUpdatedAtByAccount={sessionUpdatedAtByAccount}
          pinnedIds={pinnedIds}
          startSession={startSession}
          open={open}
          renameSession={renameSession}
          forkSession={forkSession}
          renameWorkspace={renameWorkspace}
          deleteWorkspace={deleteWorkspace}
          insertWorkspaceBefore={insertWorkspaceBefore}
          archiveSession={archiveSession}
          insertSessionBefore={insertSessionBefore}
          searchSessions={searchSessions}
          searchResultLimit={searchResultLimit}
          t={t}
        />
      </div>
    </div>
  )
}
