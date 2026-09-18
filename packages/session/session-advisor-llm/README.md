---
description: "Shared model-backed advisory-run policy for users and maintainers configuring the Smart-steer queue advisor or debugging advisory LLM runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-advisor-llm

English | [中文](README.zh.md)

Shared framing, section-streaming, timeout, and validation policy for one Smart-steer queue advisor run: a model-backed side conversation that reads a read-only snapshot of the active session and answers whether the queued message should be sent now or held.

## Summary

The advisor answers one question per queued message — "should this message interrupt the running turn now?" — from a read-only snapshot: the queued message, the conversation tail, and recent user requests. The model contract emits one JSON object whose top-level keys `tail`, `compare`, `risk`, `verdict` complete in that order; `AdvisorSectionWatcher` reports each key the moment its value closes, so host code logs an `advisor/step` event per completed phase while the stream is still running. The run never mutates the main agent loop; explicit user action is the only bridge from a verdict back to the queue.

## Table of Contents

- [Use this package](#use-this-package)
  - [Events](#events)
  - [Configuration](#configuration)
  - [Host dispatcher](#host-dispatcher)
- [Understand the implementation](#understand-the-implementation)
  - [Design concept](#design-concept)
  - [Source map](#source-map)
- [Model Experience](#model-experience)

## Use this package

### Events

The package merges four required-on-read event types into `SessionEventMap`:

| Event | Payload | Role |
| --- | --- | --- |
| `advisor/run-requested` | `AdvisorRunRequestedEventData` | Log-only pre-dispatch record: exact system prompt, snapshot messages, route, token cap. |
| `advisor/step` | `AdvisorStepEventData` | One completed phase (`tail`, `compare`, `risk`, `verdict`) with the model's verbatim finding. |
| `advisor/verdict` | `AdvisorVerdictEventData` | Final `send-now` / `hold` decision with the model's confidence. |
| `advisor/failed` | `AdvisorFailedEventData` | Run ended without a verdict: stream failure, timeout, contract violation, or a framing failure before the request event (then `runId` is null). |

The advisory prompt and findings are model-visible-by-design and reconstructable from these events (model-visible ⟺ logged). Projections that show the run live in a client read these events; they must not re-derive findings. The client compares the model's confidence against its own `smartSteerMinConfidence` gate — the gate is not re-logged in the payload.

### Configuration

`AdvisorLlmConfig` is required with no defaults: `maxInputBytes` (UTF-8 cap applied to the complete framed snapshot, oldest tail entries dropped first), `maxOutputTokens`, `timeoutMs` (end-to-end run deadline), `tailEntries` and `recentRequests` (snapshot framing widths), and the paired `provider`/`model` route override. Resolve through `resolveAdvisorLlmConfig` before dispatch; unknown keys fail loud at load. The advisory policy tolerates an absent route, while the dispatcher service rejects any unpaired or missing pair at load (misconfiguration fails loud).

## Understand the implementation

### Projection vocabulary

The package merges one key into the session-projection maps: `advisor/run` → `AdvisorRunProjection | null`. The pure fold unit in `src/projection.ts` turns the `advisor/*` events into the whole-run value: `status: 'running' | 'done' | 'failed'`, completed `steps` with verbatim findings, and the settled `verdict`; a second `advisor/run-requested` replaces the previous run, and the value is `null` before the first run. The dispatcher registers the unit on mount and removes it on disposal. Client surfaces read that key through the standard `useProjection` seat — no client-side folding.

### Host dispatcher

`src/dispatcher.ts` default-exports `QueueAdvisorService`, the model-backed side-run entry. The session controller's `advise` queue action — a member of the existing `QueueAction` union, so no new Remote method — resolves this optional service and calls `run({session, queuedItemId, queuedMessage})`; the run rejects only when the deployment mounts no dispatcher (the client's tier-1 sheet stands). The service reads the conversation snapshot through `ctx.sessionQuery.readSession` (no synchronous event-log reads), appends `advisor/run-requested` whose branded seq becomes the `runId`, streams the auxiliary route through `AdvisorSectionWatcher`, and appends an `advisor/step` per closed section, `advisor/verdict` on a contract-valid verdict, or `advisor/failed` on stream failure, timeout, contract violation, or a framing failure before the request event. The dispatcher is not part of shipped profile defaults; mounting is a deployment decision declared in `cordis.yml` with explicit config values.

### Design concept

One model call produces the whole decision; the fixed key order in the system prompt turns one stream into four observable phases. The watcher is a pure character-level state machine (nesting depth, string and escape state) that closes a section at the boundary where its value's nesting returns to depth 1, or at the root brace for the final section. It tolerates unknown keys — mapping keys to the fixed `AdvisorStepId` phases and dropping others is the dispatcher's job — and reports a truncated stream through `finish()` instead of throwing.

### Source map

- `src/types.ts` — event payloads, `AdvisorRunId`, `AdvisorStepId`, and the deployment policy types.
- `src/index.ts` — `SessionEventMap` merge, config schema and resolver, `buildAdvisorMessages` (byte-bounded snapshot framing), `buildAdvisorSystemPrompt` (pinned section contract), `AdvisorSectionWatcher`.
- `src/projection.ts` — the pure `advisor/run` fold unit and its state/wire schemas.
- `src/dispatcher.ts` — the `QueueAdvisorService` plugin: snapshot read, run events, stream dispatch, section landing.

## Model Experience

### Advisory side request

#### What the model sees

The advisor model receives the pinned system instruction fixing the four-key JSON contract (`tail`, `compare`, `risk`, `verdict`) and one user message containing the JSON snapshot: the queued message, the conversation tail, and recent user requests, byte-bounded by `maxInputBytes` with the oldest tail entries dropped first.

#### Token effect

The advisory request consumes tokens according to snapshot input size and `maxOutputTokens`. It is separate from the main agent request and never adds advisor text or framing to agent history; the visible run lives in `advisor/*` session events.

#### KV Cache effect

No main-request invalidation. The fixed system instruction is reusable across runs while the JSON snapshot changes per queued message; auxiliary cache reuse is provider-specific.

## Known Limitations and Deferred Work

- The Web profile mounts `QueueAdvisorService` with explicit `provider`/`model` values; other profiles opt in through a `cordis.yml` row with the same explicit shape.

### Dev Note

The section watcher reports any closed top-level key, not only the four contract keys: the dispatcher owns mapping keys to `AdvisorStepId` phases so a provider that adds keys degrades to fewer visible steps instead of a failed run.

- No invariant companion is published: the dispatcher-to-projection relationship is durably recorded in the session log and already observed by the real-composition dispatcher tests; no independent runtime observation can diverge from them.
