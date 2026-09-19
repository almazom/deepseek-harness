---
description: "The isolated Smart-steer plugin: the model-backed queue advisor dispatcher, the human /side (alias /btw) command over it, and both session projections, in one package a deployment mounts or omits as a unit."
kind: "package-reference"
---

# @deepseek-ai/dsh-smart-steer

English | [中文](README.zh.md)

## Summary

`dsh-smart-steer` owns the whole Smart-steer advisory surface between the user and the system in one isolated plugin: the model-backed `queueAdvisor` dispatcher, the `/side` (`/btw`) command that asks it one side question, the two projections they read and publish (`advisor/run`, `smart_steer/latest-human`), and the browser advisor surface rendering the verdicts. A mount without advisor config registers the command surface only; a mount with an explicit provider/model route also constructs the dispatcher. The advisory run streams its phases into the session log and never mutates agent history; explicit user action is the only bridge from an advisory verdict back to the queue.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the root plugin wherever the command surface belongs — the shipped presets are the reference — and pass advisor config only where the dispatcher should exist; the shipped Web profile instead mounts the `./dispatcher` entry as its `queue-advisor` host service with explicit config values.

### Mount reference

| Row shape | Effect |
|---|---|
| `- id: smart-steer` with `name: '@deepseek-ai/dsh-smart-steer'` | Registers `/side`, `/btw`, and the `smart_steer/latest-human` projection; no dispatcher |
| Same row plus `config` with a paired `provider`/`model` and the five numeric limits | Also constructs `QueueAdvisorService` on `ctx.queueAdvisor`; incomplete config fails loud at load |
| `name: '@deepseek-ai/dsh-smart-steer/dispatcher'` | Dispatcher service only, for planes that must not register the command surface |
| Browser roster row `- id: smart-steer-client` with the package name | Registers the advisor surface into the queue dock's `conversation.input.dock.advisor` slot and the `smart-steer` locale dictionaries |

### Command reference

| Input | Result |
|---|---|
| `/side <question>` | Starts one advisory run over the latest pending queued message with the typed question; the direct result names the targeted message |
| `/btw <question>` | Alias spelling of `/side`, registered as its own command definition wired to the same handler |
| `/side` (no input) | Usage error: a side question is required |
| `/side <question>` with an empty queue | Starts the advisory run over the latest delivered human message; without any human message yet, a usage error says to send a message first |
| `/side <question>` without a mounted advisor | Direct error naming the deployment gap |

<a id="understand-the-implementation"></a>
## Understand the implementation

### Root plugin

`src/index.ts` named-exports the function plugin (`name: 'smart_steer'`, `inject: ['commands', 'sessionProjections']`). `apply` registers the side-command fragment and, only when the mount config carries a paired provider/model, plugs `QueueAdvisorService` so the service's own required-field schema validates the complete policy.

### Host dispatcher

`src/dispatcher.ts` default-exports `QueueAdvisorService`, the model-backed side-run entry. The session controller's `advise` queue action — a member of the existing `QueueAction` union, so no new Remote method — resolves this optional service and calls `run({session, queuedItemId, queuedMessage})`; the run rejects only when the deployment mounts no dispatcher (the client's tier-1 sheet stands). The service reads the conversation snapshot through `ctx.sessionQuery.readSession` (no synchronous event-log reads), appends `advisor/run-requested` whose branded seq becomes the `runId`, streams the auxiliary route through `AdvisorSectionWatcher`, and appends an `advisor/step` per closed section, `advisor/verdict` on a contract-valid verdict, or `advisor/failed` on stream failure, timeout, contract violation, or a framing failure before the request event.

### Side command

`src/side-command.ts` registers two `CommandDefinition`s (`side`, `btw`) sharing one handler — the command registry has no alias concept, so the alias is a second registration, and both spellings appear in discovery UI. The handler resolves the optional `queueAdvisor` service through the strict service store, picks the latest pending item (`nextTurn` last, else `nextStep` last), joins its text blocks verbatim, and fires `queueAdvisor.run` fire-and-forget exactly like the session controller's `advise` action. On an empty queue the handler reads the `smart_steer/latest-human` projection and anchors the run to that message id, so the fallback reads maintained projection state instead of scanning historical events.

### Projection vocabulary

The package merges two keys into the session-projection maps. `advisor/run` → `AdvisorRunProjection | null` folds the `advisor/*` events into the whole-run value: `status: 'running' | 'done' | 'failed'`, completed `steps` with verbatim findings, and the settled `verdict`; a second `advisor/run-requested` replaces the previous run. `smart_steer/latest-human` → `LatestHumanMessage | null` is a host-only fold over `user/message` events that keeps the newest direct human prompt with non-empty text; injected context and attachment-only messages never qualify. Client surfaces read these keys through the standard projection seats — no client-side folding.

### Advisory framing

One model call produces the whole decision; the fixed key order in the system prompt turns one stream into four observable phases (`tail`, `compare`, `risk`, `verdict`). `AdvisorSectionWatcher` is a pure character-level state machine that closes a section when its value's nesting returns to depth 1, tolerates unknown keys — the dispatcher maps keys to phases and drops others — and reports a truncated stream through `finish()` instead of throwing. `AdvisorLlmConfig` has no defaults: the five numeric limits frame the snapshot and deadline, unknown keys fail loud at load, and the dispatcher rejects any unpaired or missing provider/model pair.

### Client surface

`src/client/index.ts` mounts the browser half: it registers the `smart-steer` locale dictionaries and contributes `AdvisorSurface` into the queue dock's `conversation.input.dock.advisor` slot. The surface is a pure function of the owner share the dock hands over (open/peek state, the advised row's facts, the confidence gate, and the follow-up/send-now callbacks); it recomputes the deterministic tier-1 pre-verdict through `runAdvisorPipeline` and reads the live `advisor/run` projection itself. The sheet never touches services, and a deployment that omits the roster row leaves the dock's smart button inert instead of broken.

### Source map

- `src/index.ts` — the merged root plugin: exports, event/projection map merges, mount semantics.
- `src/config.ts` — config schema and resolver, snapshot framing builders, `AdvisorSectionWatcher`.
- `src/types.ts` — event payloads, `AdvisorRunId`, `AdvisorStepId`, and the deployment policy types.
- `src/advisor-projection.ts` — the pure `advisor/run` fold unit and its state/wire schemas.
- `src/latest-human.ts` — the `smart_steer/latest-human` fold unit and its validated state.
- `src/side-command.ts` — the `/side` (`/btw`) registration and handler.
- `src/dispatcher.ts` — the `QueueAdvisorService` plugin: snapshot read, run events, stream dispatch, section landing.
- `src/client/` — the browser advisor surface (`AdvisorSurface`), the tier-1 brain it folds (`advisor.ts`), and the `smart-steer` locale dictionaries.

<a id="model-experience"></a>
## Model Experience

### Advisory side request

#### What the model sees

The advisor model receives the pinned system instruction fixing the four-key JSON contract and one user message containing the JSON snapshot: the queued message, the conversation tail, and recent user requests, byte-bounded by `maxInputBytes` with the oldest tail entries dropped first. The findings are model-visible-by-design and reconstructable from the `advisor/*` events.

#### Token effect

The advisory request consumes tokens according to snapshot input size and `maxOutputTokens`. It is separate from the main agent request and never adds advisor text or framing to agent history.

#### KV Cache effect

No main-request invalidation. The fixed system instruction is reusable across runs while the JSON snapshot changes per queued message; auxiliary cache reuse is provider-specific.

### Command result

#### What the model sees

Nothing. Commands, their arguments, and their results live in the log-only `command/run`/`command/done` records, and no advisor text enters agent history.

#### Token effect

Zero: no system-prompt sections and no tool schemas are added.

#### KV Cache effect

Zero growth: the package contributes no system-prompt content, so agent KV caches are unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Web profile mounts the dispatcher entry with explicit `provider`/`model` values; other profiles opt in through a root-plugin row with the same explicit shape.
- A start failure after the command settles (advisor route down) surfaces only as a host warning log plus the advisor sheet's absence; the command result has already reported success. Folding a start failure into a `command/done` correction needs a lifecycle replay seam the command plane does not expose yet.
- The alias is spelled as two command definitions, so both appear in command discovery; a registry-level alias concept is deferred until a second command needs it.
- A row queued after a rowless run starts but before the empty-queue sheet adopts it leaves that run without a visible sheet; the run's events still land in the log and the queued row's own smart button stays available.
- The command handler reads the queue at command time, so a row still in its client-side submission echo (not yet spliced server-side) lets the command fall back to the latest delivered message instead of anchoring that row; the run still starts and the committed row keeps its smart button.
- The queue smart button and the advisor slot wiring remain in `ui-conversation`; the sheet itself is this package's client half, and moving the button out of the dock belongs to a later topology pass.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The empty-queue fallback anchor is the package's own `smart_steer/latest-human` projection unit registered by the root plugin's `apply`; a change to its fold semantics must bump `stateVersion`. Command copy lives in host code, not the client locale dictionary; only the advisor sheet strings do. The section watcher reports any closed top-level key, not only the four contract keys, so a provider that adds keys degrades to fewer visible steps instead of a failed run. No invariant companion is published: the dispatcher-to-projection relationship is durably recorded in the session log and observed by the real-composition tests; no independent runtime observation can diverge from them.

</details>
