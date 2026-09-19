# Agent Note: Smart-steer client surface moves into the smart_steer plugin

Status: implemented

English | [中文](2026-09-19-smart-steer-client-half-isolation.zh.md)

- Kind: architecture
- Scope: packages/plugins/smart_steer, packages/client/ui-conversation, packages/bundle/web-app
- Date: 2026-09-19

## Problem

The Smart-steer package owned the host half of the advisory feature (dispatcher, `/side` command, projections), but its client surface — the `AdvisorSheet` component, the deterministic tier-1 brain in `queue/advisor.ts`, the peek pill, and the whole `advisor.*` locale vocabulary — lived inside `packages/client/ui-conversation`. A deployment that omitted the smart_steer plugin still shipped every byte of the advisor UI, and the "isolated plugin a deployment mounts or omits as a unit" claim in the package README was only half true.

## Decision

The queue dock keeps only the slot: `conversation.input.dock.advisor` (name mirrors the composition path per the client slots rules; the kanban card's `queue:advisor-sheet` spelling was renamed to comply). It is a `single`/`session` slot whose owner share (`AdvisorOwnerProps`, owned by the plugin's `src/client/owner.ts` which augments the SlotMap) carries raw facts and callbacks only — open/peek state, the advised row's preview, `minConfidence`, the live-running flag, and the `followUp`/`onSendNow`/`onCollapse`/`onExpand`/`onClose` callbacks. The dock no longer imports the sheet, the brain, `createPortal`, or the advisor locale keys; `lastHumanPreview` stays in `ui-conversation` as `queue/preview.ts` because it folds conversation records the plugin never sees.

The smart_steer package gains a client half under `src/client/` with a `./client` export and a `dsh.client` web manifest: `index.ts` registers the `smart-steer` locale namespace and contributes `AdvisorSurface` into the slot; `AdvisorSurface.tsx` renders the peek pill (portaled to `document.body` so it outlives the hidden dock) or the sheet as a pure function of the owner share, recomputing the tier-1 pre-verdict through the moved `runAdvisorPipeline` and reading the live `advisor/run` projection itself. The `advisor/*` locale keys moved wholesale into the plugin's namespace; the sheet trims the follow-up question itself, since the dock now forwards composer text verbatim.

Type-only seams keep the faces honest: the slot contract belongs to the plugin — `src/client/owner.ts` declares the `AdvisorOwnerProps` share and augments `@deepseek-ai/dsh-client-ui-slots`, and the plugin's client face re-exports the `AdvisorRunProjection` type alongside the projection/event map merges, so `ui-conversation` references only smart_steer's **client** leaf; no edge points back from the plugin into `ui-conversation`. `session-controller`'s host aggregate reference moved to the host leaf for the same composite-rule reason. The web bundle's browser roster gains a `smart-steer-client` row; unmounting it leaves the dock's smart button present but inert.

## Alternatives considered

- Keep the sheet in ui-conversation and let the plugin drive it through services — rejected: behavior between packages crosses only slots/services/UI, and a UI component driven through a service is exactly the coupling the isolation phase removes.
- Have the dock import the brain from `@deepseek-ai/dsh-smart-steer` at runtime — rejected: function plugins must not runtime-import another functional plugin; the dock instead reports facts and the plugin computes.
- Keep the SlotMap entry and owner-share types in `ui-conversation`'s `contract/slots.ts` — once the plugin's client face referenced `ui-conversation` for the slot entry while the dock referenced the plugin for the sheet, the pair formed a project-reference cycle the composite detector rejected; moving the slot contract into the plugin (which owns the advisor vocabulary) leaves `ui-conversation` with a single outgoing edge.

## Consequences

- Test ownership follows the code: the 13 brain tests moved to `packages/plugins/smart_steer/tests/advisor.client.spec.ts`, the 4 `lastHumanPreview` tests stay in `ui-conversation` as `preview.client.spec.ts`, and the dock spec (46 tests) asserts the owner-share contract through a `renderSlot` mock instead of DOM sheet output.
- The ui-theme elevated-surface gate now sees the peek pill's `--dsw-alias-bg-layer-2` in the plugin sheet, so `AdvisorSurface.module.css` carries the scrollbar-color rebind the dock stylesheet used to contribute.
- `verify-client-packages` counts smart_steer as a 52nd client package (its `dsh.client` manifest is the first outside `packages/client/` for a plugins-group package); `verify-cordis-config` validates the new roster row, and the doc slot trees list the child slot.
- A deployment that omits the plugin now truly ships no advisor UI; one that omits only the client roster row keeps the host half fully working.
