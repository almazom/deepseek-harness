# 2026-09-21 — sessions landing page: the keyed main panel as a page, not a drawer

## Context

The web client had one shipped `main` slot entry (`conversation`). On narrow
viewports the sidebar toggle expanded the sidebar column over the content as a
drawer (`narrowExpanded`), which probing showed was already unusable: with the
column hidden, the stock narrow controls rendered at zero size and only the
injected mobile menu worked. The operator asked for ZCode-style page
navigation: a Sessions landing page at full width, entered from the sidebar
toggle, exited with a back arrow.

## Decision

1. The landing is a keyed `main` entry `key: 'sessions'` registered by
   ui-workspace (`ctx.slots.inject('main', ...)`, children
   `sessions.page.directoryFlow`), rendering `SessionBrowserCore` — the core
   extracted from `WorkspaceBrowser` in commit `63e48d62ba` — plus a counts
   header derived from framework-hook data. No new package, no new data path.
2. Narrow navigation replaced the drawer mechanism: a narrow frame never
   shows the expanded sidebar column — `AppFrame` collapses it to the 56 px
   rail on every frame below 1024 px (view-derived from the viewport, so
   resizing replaces the old store-level crossing logic), and with a main
   panel active the sidebar track drops to zero entirely (`pageNavigation`
   solve overriding `computeColumns`' rail floor). The shell's fold controls
   call `selectPanel('sessions')` below 1024 px. `narrowExpanded` was removed
   from `LayoutState`/`LayoutInfo` entirely; the store boots a narrow frame
   with the sidebar closed and toggles flip 0 ⟷ default on both viewport
   classes (the stored preference reappears verbatim on the wide side of a
   resize).
3. The back affordance is a narrow-only chevron-left button in the conversation
   session header calling `selectPanel(null)`; the layout service's narrow fact
   reaches the header through the inject `hooks` compartment (`narrowFact` on
   `LayoutController`), keeping subscription machinery out of components.
4. ui-conversation's inject list gained the `layout` service for the back
   affordance; spec harnesses provide a stub layout service plus the narrow
   observable.

## Consequences

- `sidebar.panellist` has its first registrant (id `sessions`), so the desktop
  sidebar gained a panel row and `retainMainPanels` retains two main keys.
- The page declares its own directory-flow hole; without a
  ui-directory-picker-browse registration for `sessions.page.directoryFlow` the
  add-workspace affordance hides (verified degradation), and a later composition
  can register the occupant to enable it on the page.
- The mobile-v2 proxy injection drives the stock sidebar toggle and therefore
  keeps working unchanged: the affordance now navigates instead of expanding.
- Snapshot fixtures were refreshed (`DSH_SNAPSHOT=refresh`) for the
  intentional assembled-output change; the pre-existing ui-chat hardcoded
  `ms` unit that blocked `verify-client-ui-i18n` moved into the locale
  dictionary in the same batch.
