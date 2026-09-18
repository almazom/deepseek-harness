---
description: "The human-facing /side (alias /btw) slash command for asking the advisor a side question about the latest queued message from a UI command plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-side

English | [中文](README.zh.md)

## Summary

`dsh-command-side` gives users the `/side` command — with `/btw` as an alias — to ask the mounted queue advisor one side question about the most recently queued message, directly from a UI command plane. The command mirrors the queue smart button's advise action: the advisory run streams through the advisor sheet while the queue and the running turn stay untouched. Commands and their direct output stay in the UI and do not enter model requests. Deployments that mount no `queueAdvisor` service get a direct error instead of a silent no-op.

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
| `/side <question>` with an empty queue | Usage error: queue a message while the turn runs, then ask again |
| `/side <question>` without a mounted advisor | Direct error naming the deployment gap |

## Understand the implementation

The plugin registers two `CommandDefinition`s (`side`, `btw`) sharing one handler — the command registry has no alias concept, so the alias is a second registration, and both spellings appear in discovery UI. The handler resolves the optional `queueAdvisor` service through the strict service store, picks the latest pending item (`nextTurn` last, else `nextStep` last), joins its text blocks verbatim, and fires `queueAdvisor.run` fire-and-forget exactly like the session controller's `advise` queue action: the run's `advisor/*` events stream through the advisor sheet, and a failed start only logs a warning. This package is a second consumer of the queue-advisor capability seam, not a new Remote surface.

## Model Experience

- **Tokens:** zero. The command, its arguments, and its result live in the `command/run`/`command/done` log records, which are log-only and never enter a model request; the advisory run itself spends the advisor route's tokens, identical to the smart-button path.
- **KV cache:** zero growth from this package. No system-prompt sections, no tool schemas.
- **Model-visible effects:** none. The queued message the run reads is unchanged, and the queue keeps the item pending exactly as the smart-button advise does.

## Known Limitations and Deferred Work

- No invariant companion is published: the command owns no cross-service relationship beyond its registry registrations, and the real-composition Loader test already observes those directly.
- A start failure after the command settles (advisor route down) surfaces only as a host warning log plus the advisor sheet's absence; the command result has already reported success. Folding a start failure into a `command/done` correction needs a lifecycle replay seam the command plane does not expose yet.
- The alias is spelled as two command definitions, so both appear in command discovery; a registry-level alias concept is deferred until a second command needs it.
