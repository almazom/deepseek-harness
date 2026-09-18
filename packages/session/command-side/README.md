---
description: "The human-facing /side (alias /btw) slash command for asking the advisor a side question about the latest queued message, or the latest conversation message on an empty queue, from a UI command plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-side

English | [中文](README.zh.md)

## Summary

`dsh-command-side` gives users the `/side` command — with `/btw` as an alias — to ask the mounted queue advisor one side question about the most recently queued message. With an empty queue the command falls back to the latest delivered human message. The queued path mirrors the queue smart button's advise action: the advisory run streams through the advisor sheet while the queue and the running turn stay untouched. Commands and their direct output stay in the UI and do not enter model requests. Deployments that mount no `queueAdvisor` service get a direct error instead of a silent no-op.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Use `dsh-command-side` in interactive deployments that mount both a command adapter and the `session-advisor-llm` dispatcher — the shipped Web profile is the reference. Without the dispatcher the command registers but every invocation reports the missing advisor.

### Command reference

| Input | Result |
|---|---|
| `/side <question>` | Starts one advisory run over the latest pending queued message with the typed question; the direct result names the targeted message |
| `/btw <question>` | Alias spelling of `/side`, registered as its own command definition wired to the same handler |
| `/side` (no input) | Usage error: a side question is required |
| `/side <question>` with an empty queue | Starts the advisory run over the latest delivered human message; without any human message yet, a usage error says to send a message first |
| `/side <question>` without a mounted advisor | Direct error naming the deployment gap |

## Understand the implementation

The plugin registers two `CommandDefinition`s (`side`, `btw`) sharing one handler — the command registry has no alias concept, so the alias is a second registration, and both spellings appear in discovery UI. The handler resolves the optional `queueAdvisor` service through the strict service store, picks the latest pending item (`nextTurn` last, else `nextStep` last), joins its text blocks verbatim, and fires `queueAdvisor.run` fire-and-forget exactly like the session controller's `advise` queue action: the run's `advisor/*` events stream through the advisor sheet, and a failed start only logs a warning. On an empty queue the handler reads the package's own `command-side/latest-human` session-projection unit — a host-only fold over `user/message` events that keeps the newest direct human prompt with non-empty text — and anchors the run to that message id, so the fallback reads maintained projection state instead of scanning historical events; injected context and attachment-only messages never qualify. This package is a second consumer of the queue-advisor capability seam, not a new Remote surface.

## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The empty-queue fallback anchor is this package's own `command-side/latest-human` projection unit registered in `apply`; a change to its fold semantics must bump `stateVersion`. Command copy lives in host code, not the client locale dictionary; only the advisor sheet strings do.

</details>

## Model Experience

### Command result and advisory run

#### What the model sees

Nothing from this package. Commands, their arguments, and their results live in the `command/run`/`command/done` log records, which are log-only. The advisory run reads framing text over the session snapshot exactly as the smart-button advise path does, and no advisor text enters agent history.

#### Token effect

Zero from this package: no system-prompt sections and no tool schemas are added. The advisory run spends the advisor route's tokens, identical to the smart-button path.

#### KV Cache effect

Zero growth: the package contributes no system-prompt content, so agent KV caches are unaffected.

## Known Limitations and Deferred Work

- No invariant companion is published: the command owns no cross-service relationship beyond its registry registrations, and the real-composition Loader test already observes those directly.
- A start failure after the command settles (advisor route down) surfaces only as a host warning log plus the advisor sheet's absence; the command result has already reported success. Folding a start failure into a `command/done` correction needs a lifecycle replay seam the command plane does not expose yet.
- The alias is spelled as two command definitions, so both appear in command discovery; a registry-level alias concept is deferred until a second command needs it.
- A row queued after a rowless run starts but before the empty-queue sheet adopts it leaves that run without a visible sheet; the run's events still land in the log and the queued row's own smart button stays available.
- The handler reads the queue at command time, so a row still in its client-side submission echo (not yet spliced server-side) lets the command fall back to the latest delivered message instead of anchoring that row; the run still starts and the committed row keeps its smart button.
