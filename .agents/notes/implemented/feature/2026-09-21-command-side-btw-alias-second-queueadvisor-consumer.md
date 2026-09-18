# Agent Note: /side (/btw) command as a second queueAdvisor consumer

Status: implemented

English | [中文](2026-09-21-command-side-btw-alias-second-queueadvisor-consumer.zh.md)

- Kind: feature
- Scope: packages/session/command-side, packages/preset/agent-presets, packages/bundle
- Date: 2026-09-21

## Problem

Advisor side runs were reachable only through the queue dock's smart button: an operator mid-turn who wanted to ask "btw, what about X?" against the latest queued message had to find the row and click it. The command plane — the one UI surface that works without touching the queue — had no spelling for the same action.

## Decision

New package `packages/session/command-side` registers two `CommandDefinition`s, `side` and `btw`, sharing one handler, because the command contract has no alias concept (`CommandDescriptor` carries `name` only). The handler resolves the optional `queueAdvisor` service through the strict service store, picks the latest pending item (`nextTurn` last, else `nextStep` last), joins the item's text blocks verbatim, and fires `queueAdvisor.run` fire-and-forget with the typed question — a literal mirror of the session controller's `advise` queue action, making the command the second consumer of the queue-advisor capability seam rather than a new Remote surface. Start failures log a warning and leave the already-returned command success intact, matching the smart-button path's acceptance semantics.

## Alternatives considered

- Extending the command registry with an `aliases` field — rejected for v1: it touches the shared `CommandDescriptor`, the discovery UI, and the loader contract for one command; two registrations are the smallest honest spelling and both appear in discovery with the alias marked.
- Calling `SessionCommandController.updateQueue` from the handler — rejected: the controller is a private member of `SessionController`, not an injectable service; the direct `ctx.get('queueAdvisor')` consumer is the sanctioned seam.
- Requiring `agent.status === 'running'` like the `steer` action — rejected: advise works on any pending queued item, and the queuedock button does not gate on status either.

## Consequences

- Both spellings appear in command discovery UI; a registry-level alias concept stays deferred until a second command needs it.
- A start failure after the command settles surfaces only as the host warning plus the advisor sheet's absence — the command result already reported success; folding a late failure into `command/done` needs a lifecycle replay seam the command plane does not expose.
- The package rides the standard composition rows (standard/ptc/cordis presets, base bundle patch and dependencies, web-app browser-plane `disabled: true`), so headless and browser bundles stay unchanged.
- `session-advisor-llm`'s README now records its invariant-companion omission reason (the bilingual pairing gate surfaced the gap while this change's READMEs were verified).
