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
- [Understand the implementation](#understand-the-implementation)
  - [Design concept](#design-concept)
  - [Source map](#source-map)
- [Model Experience](#model-experience)

## Use this package

### Events

The package merges three required-on-read event types into `SessionEventMap`:

| Event | Payload | Role |
| --- | --- | --- |
| `advisor/run-requested` | `AdvisorRunRequestedEventData` | Log-only pre-dispatch record: exact system prompt, snapshot messages, route, token cap. |
| `advisor/step` | `AdvisorStepEventData` | One completed phase (`tail`, `compare`, `risk`, `verdict`) with the model's verbatim finding. |
| `advisor/verdict` | `AdvisorVerdictEventData` | Final `send-now` / `hold` decision with confidence and the gate threshold it was compared against. |

The advisory prompt and findings are model-visible-by-design and reconstructable from these events (model-visible ⟺ logged). Projections that show the run live in a client read these events; they must not re-derive findings.

### Configuration

`AdvisorLlmConfig` is required with no defaults: `maxInputBytes` (UTF-8 cap applied to the complete framed snapshot, oldest tail entries dropped first), `maxOutputTokens`, `timeoutMs` (end-to-end run deadline), and the optional paired `provider`/`model` route override. Resolve through `resolveAdvisorLlmConfig` before dispatch; unknown keys fail loud at load.

## Understand the implementation

### Projection vocabulary

The package merges one key into `SessionProjectionMap`: `advisor/run` → `AdvisorRunProjection`. The host dispatcher republishes the whole run value as each phase closes and at settlement (`status: 'running' | 'done' | 'failed'`, completed `steps` with verbatim findings, and the settled `verdict`). Client surfaces read that key through the standard `useProjection` seat — no client-side folding.

### Design concept

One model call produces the whole decision; the fixed key order in the system prompt turns one stream into four observable phases. The watcher is a pure character-level state machine (nesting depth, string and escape state) that closes a section at the boundary where its value's nesting returns to depth 1, or at the root brace for the final section. It tolerates unknown keys — mapping keys to the fixed `AdvisorStepId` phases and dropping others is the dispatcher's job — and reports a truncated stream through `finish()` instead of throwing.

### Source map

- `src/types.ts` — event payloads, `AdvisorRunId`, `AdvisorStepId`, and the deployment policy types.
- `src/index.ts` — `SessionEventMap` merge, config schema and resolver, `buildAdvisorMessages` (byte-bounded snapshot framing), `buildAdvisorSystemPrompt` (pinned section contract), `AdvisorSectionWatcher`.

## Model Experience

### Advisory side request

#### What the model sees

The advisor model receives the pinned system instruction fixing the four-key JSON contract (`tail`, `compare`, `risk`, `verdict`) and one user message containing the JSON snapshot: the queued message, the conversation tail, and recent user requests, byte-bounded by `maxInputBytes` with the oldest tail entries dropped first.

#### Token effect

The advisory request consumes tokens according to snapshot input size and `maxOutputTokens`. It is separate from the main agent request and never adds advisor text or framing to agent history; the visible run lives in `advisor/*` session events.

#### KV Cache effect

No main-request invalidation. The fixed system instruction is reusable across runs while the JSON snapshot changes per queued message; auxiliary cache reuse is provider-specific.

## Known Limitations and Deferred Work

- The host-side dispatcher (queue-advisor plugin wiring the LLM service, run events, and controller command) lands with its consuming consumer; this package ships the shared policy and the section watcher it needs.

### Dev Note

The section watcher reports any closed top-level key, not only the four contract keys: the dispatcher owns mapping keys to `AdvisorStepId` phases so a provider that adds keys degrades to fewer visible steps instead of a failed run.
