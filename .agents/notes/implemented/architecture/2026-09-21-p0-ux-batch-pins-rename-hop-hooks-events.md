# Agent Note: P0 UX batch — pins, rename hop, hooks events, and what the swarm changed

Status: implemented

## Problem

A five-feature UX batch (header rename, goal pill, reasoning left rule, hooks telemetry card, session pins) landed across ui-conversation, ui-goal, ui-chat, and ui-workspace. Three structural choices in it had fleet-wide consequences that a single-feature review would miss: an additive persisted field forced a viewing-store key bump, a client package needed to see hook events whose declarations live in `packages/hooks/hook-protocol`, and a shared header affordance became conditional on an injection that not every composition provides. An independent six-reviewer swarm (architect, critic, security, perf, Nielsen, plus a cross-harness G3 judge on the Kimi coding plan) then judged the committed batch and found three behavioral P1s the implementation review had missed.

## Decision

**Additive viewing state still bumps the persist key; the engine-level fix is a separate decision.** The viewing store hydrates by whole-value replacement (`client-store` attaches the parsed payload as the state), so a v5 payload without `pinnedIds` would leave the field undefined and crash the sidebar on `.includes`. The key therefore bumps to `dsh.workspace.view.v6`. A shallow-merge in `attachPersistence` would let future additive fields skip the bump, but merging silently resurrects removed or renamed fields on schema evolution — that trade-off is an engine-design decision affecting every persisted store, and it is recorded here as the open follow-up instead of being slipped into a UI batch. Cost of the bump: users' persisted groupBy/orderBy/session order reset once; the v5 key is orphaned (never read, never deleted).

**The client face of hook events is declared by mirroring, and that is a known drift risk.** Client programs do not compile `@deepseek-ai/dsh-hook-protocol`, so `ui-chat`'s event projection re-declares `hook/invoked` and `hook/result` on `SessionEventMap` with a keep-in-sync comment. The session-controller `model/selection` precedent is merging by the owning package; mirroring in the consumer is the weaker variant, accepted here because the alternative (type-only devDependency import) crosses the client/host package seam that the client face deliberately keeps closed. A type-equality test compiling both declarations is the mechanical-enforcement follow-up.

**An injected header verb is optional, and the affordance must gate on the same predicate as the handler.** `ConversationSessionHeaderInjected.rename` is optional because compositions without the sessions hop must still render the header. The first cut gated the pencil on the verb alone: a subagent session (whose crumb is excluded from hosting the editor) rendered a pencil that opened a renaming state with no input — found by the G3 judge as a blocking P1. Rule: affordance visibility derives from the full reachability predicate, not just dependency presence.

**Collapse limits must exempt state-carrying rows.** The five-row session collapse already exempted the provisional blank row; pinned rows needed the same exemption, or pinning silently stopped working in default-collapsed groups and the overflow count lied (critic P1). The visible-row set used by reveal and drag math threads the same pinned set, so the three consumers cannot diverge.

## Verification

`pnpm run typecheck` exits 0; `pnpm run test:gui` is green (384 files / 5473 tests, +2 swarm-spec cases: pinned row visible past the collapse cut with a truthful overflow count, and subagent headers rendering no rename affordance); the frozen `git diff --name-only --diff-filter=M HEAD -- 'packages/client/*/tests'` line is empty (only session-authored specs were touched, by type-only commits 346fcdae14 and the swarm commits). Swarm evidence and per-finding dispositions live in `trello-cards/2026-09-21T15-07-43_zcode-p0-ui/verify/`.

## Alternatives considered

Merging hydration in `attachPersistence` was rejected for this batch (resurrects stale fields on removal; engine-wide blast radius) and recorded as the follow-up. Wiring pins into flat-list mode was rejected against withholding the menu item: flat rows have no pinned section, so the affordance would still lie. Coalescing concurrent same-key hook runs was rejected against documenting the latest-open heuristic: the payload carries no invocation id, so coalescing would fabricate aggregate durations while the heuristic at least stays per-run.
