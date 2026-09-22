/**
 * Layout plugin, browser half: one register() call contributes AppFrame into
 * the runtime's built-in 'root' slot and, in the same breath, declares the
 * four child slots (declaration = exclusive render authority), seats the
 * layout store (panel geometry), and wires the panel-action service face.
 * ctx.layout selects the main panel and controls column geometry; Session
 * selection belongs to the Session Controller. A second effect seats the theme
 * presenter, which projects ctx.theme snapshots onto document.body.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { HostObservable, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { PanelInfo, PanelPathBridge } from './service.ts'
import type { MainPanelId } from './service.ts'
import { SIDEBAR_AUTO_COLLAPSE } from './columns.ts'
import { AppFrame } from './AppFrame.tsx'
import { createLayoutStore } from './stores.ts'
import { LayoutController } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'

// Contract exports only (export-convergence rule: cross-package consumers
// keep a symbol exported; test-only/package-internal symbols live off /src).
// ILayout: the ctx.layout face consumers and test fakes type against.
// OwnerShare contracts below are the render-side halves registrants compose
// against; the frame components and the store factory are package-internal.
export { LayoutController } from './service.ts'
export type { ILayout, MainPanelId, PanelInfo } from './service.ts'

/** Selector hook over root-scoped panel selection. */
export type UsePanelInfo = SnapshotSelectorHook<PanelInfo>

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward face only; the concrete service stays inside this plugin. */
    layout: import('./service.ts').ILayout
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface GlobalStandardProps {
    /** Subscribe to the selected main panel independently of parent renders. */
    usePanelInfo: UsePanelInfo
  }

  interface SlotMap {
    // The 'root' entry itself is the runtime's built-in slot (declared
    // there); these four are the frame's children, declared by the same
    // register() call that contributes AppFrame. Session owners never pass
    // sessionId: the framework injects it as a standard prop.
    /**
     * The whole left column. OCCUPIED by ui-sidebar's SidebarRoot, which
     * declares the workspace and settings seats inside it — registering here
     * replaces the navigation column outright rather than adding to it, and
     * the seats it declares disappear with it. To add something to the
     * sidebar, register into one of those inner seats instead.
     *
     * The occupant receives the frame's live column state (collapsed, width)
     * and is expected to render the compact control rail while collapsed.
     */
    'sidebar': { kind: 'single'; scope: 'root'; owner: SidebarOwnerProps }
    /**
     * Central panel selected by sidebar entry id. The reserved `conversation`
     * key hosts the Conversation; other keys receive no Session binding.
     */
    'main': { kind: 'keyed'; scope: 'root' }
    /**
     * The right column: a track the centre makes room for, or nothing. OCCUPIED
     * by the right Sidebar, which uses the resolved column width in normal
     * mode and covers the viewport in fullscreen, retaining the wide-screen
     * column reservation underneath.
     *
     * Whether the panel is shown, and whether it takes a track, is the
     * occupant's own recorded business — it reports the composition of its
     * expanded and presentation state through `ctx.layout`, and the frame sizes
     * the track and places the resize handle from that. The expand control is
     * not this column's: it is a button in the conversation header. The root
     * occupant decides when to render its Session-bound content.
     */
    'rightbar': { kind: 'single'; scope: 'root'; owner: RightbarOwnerProps }
    /**
     * Frame-wide floating layer, above every column and outside their scroll
     * containers. Deliberately generic and unowned by any feature: a badge, a
     * toast stack or a status pill all belong here, and entries order among
     * themselves. The layer itself is click-through — entries opt back into
     * pointer events — so an occupant never blocks the app underneath.
     *
     * This is the additive seat for a frame-wide surface of your own: a fresh
     * `id` is added beside the shipped entries instead of replacing them.
     */
    'shell.overlay': { kind: 'list'; scope: 'root' }
  }
}

// OwnerShare contracts — the render-side share the slot owner supplies at
// renderSlot. Registrants IMPORT these and compose their full component props
// through the four-share intersection (PropsRuntime & PropsRenderSlots &
// PropsStore & I). Conversation business state and actions arrive through
// framework-standard hooks and each registrant's inject face, not owner props.

/** Sidebar owner share: live column state from the frame's concession solve. */
export interface SidebarOwnerProps {
  /** True when the sidebar is closed (the column renders the compact control rail). */
  collapsed: boolean
  /** Rendered column width in px (SIDEBAR_COLLAPSED when collapsed; 0 under page navigation). */
  width: number
  /** Whether the frame is narrow (below SIDEBAR_AUTO_COLLAPSE): the shell's toggle navigates instead of folding. */
  narrow: boolean
}

/** Right column owner share: resolved normal geometry and opening eligibility. */
export interface RightbarOwnerProps {
  /** Resolved normal panel width in px, not the saved preference; zero if it cannot fit. */
  width: number
  /** Current frame width in px. */
  viewportWidth: number
  /**
   * Whether a normal right panel can retain 300px beside a 400px center.
   * Before a narrow opening, includes the space from collapsing the left sidebar.
   */
  canShow: boolean
}

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'theme', 'locale']

/**
 * Panel page-path suffixes for narrow-frame navigation: selecting the panel
 * reads as its own clean page (`<base>/<suffix>`) rather than an unfolded
 * sidebar. Wide frames keep the sidebar model and never touch the path.
 */
const PANEL_PAGE_SUFFIXES: Readonly<Record<string, string>> = {
  sessions: 'sessions',
}

/**
 * Build the narrow-frame URL bridge over the browser history API. The bridge
 * is pure routing glue: it never touches layout state (the controller and the
 * popstate/boot handlers own that) and preserves the query string so auth
 * token URLs survive a page navigation.
 * @returns the bridge passed to the layout controller.
 */
function createPagePathBridge(): PanelPathBridge {
  const baseWith = (suffix: string | null): string => {
    const url = new URL(location.href)
    let pathname = url.pathname
    for (const pathSuffix of Object.values(PANEL_PAGE_SUFFIXES)) {
      const withSlash = `/${pathSuffix}`
      if (pathname === withSlash) pathname = '/'
      else if (pathname.endsWith(withSlash)) pathname = pathname.slice(0, pathname.length - withSlash.length)
    }
    if (suffix !== null) pathname = pathname === '/' ? `/${suffix}` : `${pathname}/${suffix}`
    url.pathname = pathname
    return url.toString()
  }
  return {
    push(panelId): void {
      const suffix = PANEL_PAGE_SUFFIXES[panelId as string]
      if (suffix === undefined) return
      history.pushState({ dshPagePath: true }, '', baseWith(suffix))
    },
    returnToBase(): void {
      // Replace, never history.back(): the entry behind the page path may be
      // the deep-link token URL that redirected to the same page, so back()
      // would land on the page again instead of leaving it.
      history.replaceState({}, '', baseWith(null))
    },
    panelFromPath(): MainPanelId | null {
      const pathname = location.pathname
      for (const [panelId, pathSuffix] of Object.entries(PANEL_PAGE_SUFFIXES)) {
        if (pathname === `/${pathSuffix}` || pathname.endsWith(`/${pathSuffix}`)) {
          return panelId as MainPanelId
        }
      }
      return null
    },
    enabled(): boolean {
      // Narrow frames only: the wide layout keeps the sidebar page model.
      return window.innerWidth < SIDEBAR_AUTO_COLLAPSE
    },
  }
}

/**
 * Client plugin body: provide ctx.layout, then one register() call — AppFrame
 * into 'root' with the four child-slot declarations, the layout store seat,
 * and the shared root instance supplying commands and the panel-info source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const handle = createLayoutStore()
    const instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    const pagePaths = createPagePathBridge()
    const layout = new LayoutController(
      instance.actions,
      id => ctx.slots.entries('main').some(entry => entry.options.key === id),
      // The narrow fact rides the same store instance: any layout-store change
      // re-renders subscribers, and the snapshot re-derives from the fresh width.
      {
        getSnapshot: () => instance.getSnapshot().layoutInfo.viewportWidth < SIDEBAR_AUTO_COLLAPSE,
        subscribe: listener => instance.subscribe(listener),
      },
      pagePaths,
    )
    // Narrow deep link / browser back: the path is the source. Runs on every
    // main-slot mutation too — a page path that names a panel not yet
    // registered resolves on the registration pass (idempotent).
    const applyPanelFromPath = (): void => {
      if (!pagePaths.enabled()) return
      const active = instance.getSnapshot().panelInfo.activePanelId
      const fromPath = pagePaths.panelFromPath()
      if (fromPath === active) return
      if (fromPath !== null && !ctx.slots.entries('main').some(entry => entry.options.key === fromPath)) return
      instance.actions.selectPanel(fromPath)
    }
    const onPopState = (): void => { applyPanelFromPath() }
    window.addEventListener('popstate', onPopState)
    const retainMainPanels = (): void => {
      instance.actions.retainMainPanels(ctx.slots.entries('main').flatMap(entry =>
        entry.options.key === undefined ? [] : [entry.options.key]))
      applyPanelFromPath()
    }
    const panelInfo: HostObservable<PanelInfo> = {
      getSnapshot: () => instance.getSnapshot().panelInfo,
      subscribe: listener => instance.subscribe(listener),
    }
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo } })
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      locale: 'common',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'main': { kind: 'keyed', scope: 'root' },
        'rightbar': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store,
      inject: () => ({
        selectPanel: (panelId: MainPanelId | null): void => { ctx.layout.selectPanel(panelId) },
      }),
    }, AppFrame)
    const disposePanels = ctx.slots.subscribe('main', retainMainPanels)
    retainMainPanels()
    applyPanelFromPath()
    return () => {
      window.removeEventListener('popstate', onPopState)
      layout.dispose()
      disposePanels()
      disposeRegistration()
      disposePanelInfo()
      // provide()'s disposer settles asynchronously; teardown is synchronous fire-and-forget.
      void disposeService()
    }
  }, 'ui-layout: service + root registration')

  // Theme presentation: pure DOM writes from resolved snapshots — initial
  // state through the getter once, then event-driven only; no React path.
  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout: theme presenter')
}
