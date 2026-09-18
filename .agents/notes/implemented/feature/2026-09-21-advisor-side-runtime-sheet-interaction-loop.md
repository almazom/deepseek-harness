# Agent Note: Advisor sheet becomes a full side-runtime interaction loop

Status: implemented

English | [中文](2026-09-21-advisor-side-runtime-sheet-interaction-loop.zh.md)

- Kind: feature
- Scope: packages/api/session-controller, packages/api/remotes, packages/client/ui-conversation
- Date: 2026-09-21

## Problem

The advisor sheet was open-only: a queued row's smart button streamed one side run, but there was no way to ask a follow-up inside the sheet, no collapsed state, and no explicit close — while the /btw side-runtime pattern requires multi-turn side questions, a peek state that keeps the main conversation interactive, and close-anytime. Two hidden traps also surfaced: the follow-up wire field was silently stripped before fetch, and the collapsed pill disappeared whenever a pending ask_user_question card hid the queue dock.

## Decision

The follow-up rides the existing `advise` queue action: `QueueAction`'s advise member gains an optional `question` field, so a second side run is one more `updateQueue` call — no new Remote method, and the host pass-through (`session-controller`) forwards the question to the dispatcher unchanged. The client sheet gains an in-sheet composer (send disabled while blank or while the advisory run streams), a collapse control that folds the sheet into a peek pill, an expand control that restores it, and an explicit close that dismisses sheet and pill while leaving the queue intact. The peek pill renders through `createPortal(document.body)` with `position: fixed; z-index: 900` (below the 1000 Modal mask): portaling is what keeps peek reachable when the question panel hides the dock column — the golden P2 rule that peek must stay clickable over any page card. The sheet sets an explicit `height: min(72dvh, 560px)` because the Modal dialog auto-height collapsed the flex-basis-0 body to the footer once content streamed.

## Alternatives considered

- A dedicated `adviseFollowUp` Remote method — rejected: it duplicates `updateQueue`'s item-addressed action spine for one optional field, exactly what the 2026-09-18 note rejected for `advise` itself.
- Keeping the peek pill inside the dock column with a z-index bump — rejected: the question panel removes the dock from layout (`display: none`), so no stacking order can resurrect the pill; the portal is the smallest change that survives the hiding.
- Force/retry the Playwright expand click over the overlay — rejected as a test workaround for a product defect; after the portal, a plain accessibility-driven click is deterministic.

## Consequences

- The stale-aggregate trap is now load-bearing doctrine: browser RPC args are parsed by a zod codec inlined into the aggregate `packages/api/remotes/lib/client.js`. That aggregate is built from each package's `./remote` entry by `pnpm --filter @deepseek-ai/dsh-api-remotes bundle`, and tsdown caching does not rebuild it when a dependency's `lib/*.js` changes. After editing any wire type in `src/types.ts`, rebuild the owning package bundle AND the remotes aggregate, or the old schema silently strips new fields (the follow-up POST carried `{"kind":"advise"}` with no `question` until the aggregate was rebuilt — no error, just loss).
- The peek pill escapes the component's render container, so component specs must query it via `screen` (document.body), and DOM assertions scoped to the RTL container no longer see it.
- The web e2e `apps/web/tests/advisor-side-runtime.e2e.ts` walks the whole loop — queue, open, streamed verdict, follow-up over the wire, peek, expand, close, checkpoint answer draining the dock — under `DSH_SNAPSHOT=replay` with zero console errors, and can drop per-state screenshots into `.goal-evidence/` when `DSH_GOAL_EVIDENCE=1`.
- New web-e2e specs are registered twice by design: excluded from the client program in `apps/web/tsconfig.json` and listed in the root `tsconfig.host.json` (they boot the host spine). Skipping the host listing leaves the file outside every project, which type-aware lint reports as error-typed imports.
