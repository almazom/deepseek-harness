/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry and main-panel selection live in the root layout store;
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (main-panel selection and sidebar toggle,
 * right-panel show/hide from ui-sidebar-right) plus the narrow-viewport fact
 * plugins read for responsive chrome — writes stay inside the store's
 * declared action set, shared with the root registration.
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { createLayoutStore } from './stores.ts'

/** Identity shared by a sidebar panel entry and its main-slot occupant. */
export type MainPanelId = Branded<'MainPanelId'>

/** Root-scoped navigation state exposed to panel-aware components. */
export interface PanelInfo {
  /** Selected global panel; null displays the current Conversation. */
  readonly activePanelId: MainPanelId | null
}

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * URL bridge for narrow-frame page navigation: on a phone or tablet the
 * selected panel is a clean page with its own path (`/sessions` after the
 * app base), not an unfolded sidebar state. The bridge owns the actual
 * history reads and writes; the controller only tells it what the user
 * selected, and honors it when the browser navigates back.
 */
export interface PanelPathBridge {
  /**
   * Push the panel's page path after a user selection.
   * @param panelId - the panel the user navigated to.
   */
  push(panelId: MainPanelId): void
  /** Return to the conversation path after an in-page back; a bridge-pushed entry goes back, a deep link is replaced. */
  returnToBase(): void
  /**
   * The panel id encoded by the current path, or null when the path is the conversation.
   * @returns a path whose suffix matches a known panel page path.
   */
  panelFromPath(): MainPanelId | null
  /** Whether the bridge applies to the current frame (narrow only; wide keeps the sidebar model). */
  enabled(): boolean
}

/** Panel navigation, geometry actions, and the narrow-viewport fact exposed through ctx.layout. */
export interface ILayout {
  /**
   * Select a global central panel without changing the current Session.
   * @param panelId - registered main key, or null to show the Conversation.
   * @throws if the selected main key is not registered; preserves the current selection.
   */
  selectPanel(panelId: MainPanelId | null): void
  /**
   * Start an asynchronous navigation, superseding any earlier pending navigation.
   * @returns a signal aborted by the next navigation or layout disposal; check it before committing UI state.
   */
  beginNavigation(): AbortSignal
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /**
   * The live narrow-viewport fact (frame below SIDEBAR_AUTO_COLLAPSE), derived
   * from the layout store's frame measurement. Bare observable: the source
   * identity and each snapshot stay stable between changes.
   */
  readonly narrow: ObservableSnapshot<boolean>
  /**
   * Report the right panel's presentation without changing its expanded state.
   * @param track - whether the normal panel width reserves a grid track,
   *   including beneath a fullscreen overlay.
   * @param fullscreen - whether the panel covers the frame and hides its outer
   *   resize handle; independent of the underlying grid track.
   */
  openRightbar(track: boolean, fullscreen: boolean): void
  /** Report the right panel as hidden: no track, no handle. */
  closeRightbar(): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  private navigation = new AbortController()

  /**
   * @param panels - actions of the instance shared with the root entry.
   * @param hasMainPanel - checks the live main-slot registry for a panel id.
   * @param narrow - the narrow-viewport fact over the same store instance.
   * @param pagePaths - narrow-frame URL bridge; omit on hosts without history routing.
   */
  constructor(
    private readonly panels: PanelActions,
    private readonly hasMainPanel: (id: MainPanelId) => boolean,
    private readonly narrowFact: ObservableSnapshot<boolean>,
    private readonly pagePaths?: PanelPathBridge,
  ) {}

  /** The stable narrow-viewport fact source over the shared layout store. */
  get narrow(): ObservableSnapshot<boolean> {
    return this.narrowFact
  }

  /** Select a global panel or return to the Conversation. */
  selectPanel(panelId: MainPanelId | null): void {
    if (panelId !== null && !this.hasMainPanel(panelId)) {
      throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
    }
    this.navigation.abort()
    this.panels.selectPanel(panelId)
    this.syncPagePath(panelId)
  }

  /**
   * Mirror a user selection into the narrow-frame page path. Store-only
   * callers (popstate handling, boot deep links) bypass this on purpose:
   * the URL is their source, not their destination.
   */
  private syncPagePath(panelId: MainPanelId | null): void {
    const bridge = this.pagePaths
    if (bridge === undefined || !bridge.enabled()) return
    if (panelId !== null) bridge.push(panelId)
    else if (bridge.panelFromPath() !== null) bridge.returnToBase()
  }

  /** @returns the new pending navigation's cancellation signal. */
  beginNavigation(): AbortSignal {
    this.navigation.abort()
    this.navigation = new AbortController()
    return this.navigation.signal
  }

  /** Invalidate pending navigations when the layout owner is unloaded. */
  dispose(): void {
    this.navigation.abort()
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.panels.toggleSidebar()
  }

  /** Report the right panel's track and fullscreen presentation. */
  openRightbar(track: boolean, fullscreen: boolean): void {
    this.panels.openRightbar(track, fullscreen)
  }

  /** Report the right panel as hidden: no track, no handle. */
  closeRightbar(): void {
    this.panels.closeRightbar()
  }
}
