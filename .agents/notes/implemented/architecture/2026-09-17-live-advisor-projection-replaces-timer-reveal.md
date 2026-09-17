# Agent Note: Live advisory projection replaces the timer-paced advisor sheet

Status: implemented

English | [中文](2026-09-17-live-advisor-projection-replaces-timer-reveal.zh.md)

- Kind: architecture
- Scope: packages/client/ui-conversation, packages/session/session-advisor-llm
- Date: 2026-09-17

## Problem

The Smart-steer advisor sheet paced its reasoning rows with `useStepReveal`, a 150 ms timer that staged rows in one by one regardless of any external fact — a fake reveal. The /btw-style live side-question run needs the opposite: phases appear because the model actually produced them, streamed from the host, and the sheet must never invent pacing.

## Decision

`session-advisor-llm` merges one key into `SessionProjectionMap`: `advisor/run` → `AdvisorRunProjection` (whole run value: `status`, completed `steps` with verbatim model findings, settled `verdict`). The host owns the computation and republishes the whole value per phase and at settlement; the client folds nothing. `QueueDock` reads the key through the standard `useProjection` seat and matches it against the advised row by `queuedItemId`; a run belonging to another row (or absent) falls back to the tier-1 pre-verdict. `AdvisorSheet` renders live phase rows with the raw finding text — model output is data, not locale copy — plus a live gate line computed from the projection's confidence against the configured `smartSteerMinConfidence`. A failed run keeps its partial findings, marks the failure, and falls back to the tier-1 gate and verdict lines, which remain the standing guidance. `useStepReveal`, `STEP_REVEAL_MS`, and `stepStatus` are deleted: tier-1 rows are computed synchronously and render instantly as `done`, and live rows appear when their projection lands.

## Alternatives considered

- Keep the timer reveal as a fallback under the live path — rejected: the goal forbids timer-faked steps, and keeping two pacing systems for one surface doubles the test matrix for zero behavior.
- Project per-step events to the client and fold them into run state in the browser — rejected by the session-projection architecture: the host is the only computation site, and a client-side domain fold would duplicate the dispatcher's state machine.
- Key the projection per queue item (`advisor/run/<itemId>`) — rejected: the advisor runs one side question at a time and the sheet shows one row; a single key with `queuedItemId` matching keeps the key space bounded and matches the queue mirror's whole-value style.

## Consequences

- The sheet's verdict and gate lines now have three sources — tier-1 outcome, live running, live verdict, live failure fallback — each covered by queue-dock component tests; a new live branch must update all of them or fail the fallback test.
- The host dispatcher shipped in [the queue-action dispatcher note](2026-09-18-advisor-side-run-dispatcher-rides-queue-action.md); until a profile mounts it, `advisor/run` reads `null` in production and the sheet behaves exactly as the tier-1 sheet did.
- Deleting the reveal timer makes the tier-1 sheet visually instant; the replay e2e assertions that waited for rows reach their final state on the first paint instead of after 600 ms.
