# Agent Note: /side falls back to the latest human message on an empty queue

Status: implemented

English | [中文](2026-09-21-command-side-empty-queue-fallback-latest-human-message.zh.md)

- Kind: feature
- Scope: packages/session/command-side, packages/session/session-advisor-llm, packages/client/ui-conversation, apps/web
- Date: 2026-09-21
- Supersedes (partial): the empty-queue error arm of [/side (/btw) command as a second queueAdvisor consumer](2026-09-21-command-side-btw-alias-second-queueadvisor-consumer.md), which stays active for the seam, alias spelling, and fire-and-forget semantics

## Problem

The v1 `/side` command answered an empty queue with a usage error, so the command was unusable exactly when operators reached for it: between turns, after a turn ended, or before anything was ever queued. Live-session forensics showed both real attempts failing that way — one mid-turn before any row had been queued, one five minutes after the turn had ended with an empty inbox. The queue was legitimately empty both times; the contract itself was wrong about when a side question makes sense. A side question needs a message to advise about, and the conversation log always has one once the operator has said anything.

## Decision

On an empty queue the command handler reads the package's own `command-side/latest-human` session-projection unit and anchors the advisory run to the message it holds: the run starts through the unchanged `queueAdvisor.run` seam with the message id in the existing `queuedItemId` payload field and the message text as `queuedMessage`. The unit is a host-only fold over `user/message` events that keeps the newest one whose source kind is `user` and whose joined text blocks are non-empty, so the fallback reads maintained projection state — synchronous historical reads are deprecated for new calls, and projection state is the sanctioned substitute; injected context (source kinds other than `user`) and attachment-only messages never qualify. The dispatcher, `SessionEventMap`, the projection, and `SESSION_FORMAT_VERSION` are untouched. The error survives only for sessions with no delivered human message at all, reworded to "No message to advise about yet: send a message first, then ask again." The success text names its target: "for queued message" on the row path, "for the latest message" on the fallback path.

In the client, `QueueDock`'s advising state became an `AdvisingAnchor { id, preview, rowless }` instead of a queue row: the row path fills it from the pending row, and the auto-open effect gains a rowless arm gated on `rowCount === 0`, so a run anchored to no pending row adopts only while the queue is empty and row-anchored runs keep their drained-row cleanup semantics. A run id adopted while a pending row backed it (either through adoption or through the smart button) is remembered, so its later drain closes the sheet instead of re-adopting the same run as rowless. The advisor surface — the peek pill portal plus the sheet — hoists above the dock's empty-queue gate, so the sheet renders over an empty queue instead of the dock returning null. `AdvisorSurface` (smart_steer client half; formerly ui-conversation `AdvisorSurface`) takes a required `rowless` prop and, for rowless runs, drops the keep-queued/send-now footer actions, the confidence-gate row, and the follow-up composer, and labels the advised message "Advising about" (顾问对象); the collapse/expand and close controls stay.

## Alternatives considered

- A `sessionQuery` service the command calls to find the anchor — rejected: `SessionQueryEngine` is abstract with no concrete harness provider, so the command would have needed a new service plus a provider, while the projection registry is already mounted wherever the command runs.
- A direct synchronous scan of the log via `session.snapshotEvents()` — rejected before implementation: new calls to the synchronous historical readers are prohibited by [the deprecation decision](../architecture/2026-09-09-deprecate-synchronous-session-event-reads.md), and a scan would make the command depend on the complete event sequence staying in memory.
- Keeping the delivery actions on a rowless sheet with the row shown as "0 queued" — rejected: keep-queued and send-now address a queue row that does not exist; rendering them invites actions that can only fail or mislead.
- Adopting rowless runs regardless of queue state — rejected: a row-anchored run whose row id no longer matches the queue would silently adopt as rowless; the `rowCount === 0` gate is what keeps the existing drained-row behavior intact.

## Consequences

- `/side` works between turns and before any queue exists; the error survives only for brand-new sessions that have no delivered human message.
- The newest run still wins the single projection slot per session, and dismissal stays keyed by run id, so an explicitly closed rowless run stays closed while its projection persists.
- The handler reads the queue at command time; the replayed e2e therefore waits for the queued row's server-side `agent/inbox/spliced` before invoking `/btw`, because the dock renders the client submission echo before the splice commits.
- The command's direct output text has no recorded-session snapshot owner (verified by search over `snapshots/`), so no snapshot refreshed; the flipped `apps/web/tests/advisor-side-command.e2e.ts` pins the fallback end to end under `DSH_SNAPSHOT=replay`: rowless success card, rowless sheet shape, Escape, then the row run with full delivery actions.
- The pinned advisor system prompt is unchanged; the rowless run receives the anchored message as `queuedMessage` framing, and `/side` always carries a typed question, so the follow-up framing rule is unaffected.
- The [sheet interaction loop](2026-09-21-advisor-side-runtime-sheet-interaction-loop.md) note stays active; the rowless sheet is an additive mode of the same interaction loop.

## Testing

- `packages/session/command-side/tests/command-side.spec.ts`: fallback to the newest human message, injected-context and attachment-only skips, the no-human-message error, and unchanged row precedence.
- `packages/client/ui-conversation/tests/queue-dock.client.spec.tsx`: rowless auto-open on an empty queue with the reduced sheet shape, dismissed rowless run stays closed, no adoption while rows are queued, and a drained row-anchored run stays closed instead of reopening as rowless.
- `pnpm run verify-client-ui-i18n` covers the new locale keys; the bilingual note and README pairing gates run in doc-sync.
