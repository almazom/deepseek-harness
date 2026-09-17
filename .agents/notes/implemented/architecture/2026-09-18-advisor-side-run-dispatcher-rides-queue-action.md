# Agent Note: Advisory side-run dispatcher rides the existing queue action

Status: implemented

English | [中文](2026-09-18-advisor-side-run-dispatcher-rides-queue-action.zh.md)

- Kind: architecture
- Scope: packages/session/session-advisor-llm, packages/api/session-controller, packages/core/session, packages/client/ui-conversation
- Date: 2026-09-18

## Problem

The `advisor/*` event vocabulary, the pure `advisor/run` fold, and the live client branch existed, but nothing produced a run: the events had no producer, `gateThreshold` still duplicated the client's confidence gate inside log payloads, and no host path turned the Smart-steer button press into the model-backed side question the /btw pattern calls for.

## Decision

The trigger is a new `advise` member on the existing `QueueAction` union, flowing the existing `updateQueue` Remote method: "advise" is a queue operation (read-only), and a new Remote method would duplicate the four-file spine for no capability. The session controller's `updateQueue` switch resolves the optional `queueAdvisor` service and rejects `session/advisor-unavailable` when the deployment mounts none, so the client's tier-1 sheet stands. `session-advisor-llm` gains `src/dispatcher.ts` (default-exported `QueueAdvisorService`) and `src/projection.ts` (the fold unit, previously described but never shipped). The dispatcher reads the snapshot through `ctx.sessionQuery.readSession` — the sanctioned asynchronous read — instead of the deprecated synchronous `Session.snapshotEvents`; it appends `advisor/run-requested` (whose branded seq is the `runId`), lands an `advisor/step` per closed section, and settles with `advisor/verdict` or `advisor/failed` (fourth event type; stream failure, timeout, and verdict-section or stream-level contract violations land there as data; malformed finding sections are dropped, and a framing failure before the request event lands with a null `runId`). `gateThreshold` is removed from `AdvisorVerdictEventData` and `AdvisorRunVerdict`: the client's `smartSteerMinConfidence` is the single home of the gate, so a deployment can retune the gate without rewriting history. The projection value is `AdvisorRunProjection | null`, and the client compares the advised row with `!= null` accordingly.

## Alternatives considered

- A dedicated `advise` Remote method — rejected: it would re-state `updateQueue`'s item-addressed action spine, and the queue union already enumerates the caller's per-item verbs.
- Auto-run the advisor whenever a message is queued — rejected: it would spend model calls without user intent and contradicts the /btw rule that explicit user action starts the side question; only the button press (or a future explicit affordance) runs it.
- Re-fold the route from the logged request header instead of config — rejected: the auxiliary advisory route is a deployment choice like any other model route; deriving it from history couples the run to whichever route happened to serve the main turn.
- Keep `snapshotEvents` for the tail read — rejected by the deprecate-synchronous-session-event-reads decision; the session-query read is the asynchronous replacement with the same observation semantics.

## Consequences

- The tier-1 pre-verdict and the live run share one trigger path; the smart button now always asks the host for a side run, and specs asserting "no delivery on open" changed to assert the read-only `advise` call instead.
- The Web profile mounts `QueueAdvisorService` with explicit `provider`/`model` values (mirroring the default agent route), so the smart button performs the side run there; other profiles reject with `session/advisor-unavailable` until they opt in. The mounted shape (insert row + explicit `provider`/`model`) is pinned twice: a real-composition Loader test in this package, and a Web e2e that streams a scripted advisory run through the shipped composition and watches the sheet complete its phases from the log projection.
- `advisor/failed` makes the whole advisory lifecycle reconstructable from the log: a replayed log yields the identical projection without any host-side recompute.
- Mounting the dispatcher registers the `advisor/run` projection unit in every Web-profile session, which measurably slows the shared event pipeline: the two threshold-tuned web e2e specs (`sidebar-right`, `chat-scroll-contract`) fail in isolation with the row present and pass at HEAD or with the row removed, while the bundle bytes are identical. Profiling the per-event cost (fold, wire view, or client subscription) and retuning those specs is deferred follow-up work; the advisor feature specs themselves are green with the row mounted.
