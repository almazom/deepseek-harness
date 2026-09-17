# Smart Steer pipeline reasoning lines (SGT-1 round 2)

- Kind: architecture
- Scope: packages/client/ui-conversation
- Date: 2026-09-17

## Context

The round-1 Smart Steer advisor panel (2b409fa, 151295b) revealed pipeline phases as status labels only (`Done`), so the operator could not see why a steer was allowed or held. The operator asked for Claude/Codex-style visible reasoning: every phase must state its finding and the verdict must justify itself against the confidence gate.

## Decision

Findings are locale-owned data, not strings. `runAdvisorPipeline(input, minConfidence)` emits one `AdvisorStepDetail` per completed phase — a typed locale key plus a `Record<string, number>` params object (uniform `{key, params}` shape; parameter-free findings carry `params: {}`). `AdvisorSheet` renders `t(detail.key, detail.params)` as a secondary line under each phase label, so zh/en copy stays in the dictionaries and the model carries no rendering concerns. The verdict phase compares the tier-1 confidence against the `smartSteerMinConfidence` Config field passed down from `QueueDock`; the gate lives only in the validated `submission-settings` schema (`DEFAULT_SMART_STEER_MIN_CONFIDENCE = 0.95`, `z.number().min(0.5).max(1)`), never as a magic number at call sites.

## Consequences

- Adding a phase means adding one locale key pair and one detail branch; the sheet needs no change.
- The detail union is closed (8 keys, ends in exhaustive locale maps); a missing zh/en key fails the locale-key tests at build time.
- Tier-1 findings are deterministic rephrasings of the same rules `advise()` applies; they add no new gating logic, so the panel cannot disagree with the action the advisor takes.
- Type-only augmentation imports (`@deepseek-ai/dsh-client-connection`, `@deepseek-ai/dsh-settings`) were added to the web e2e scaffold, and `apps/web/tsconfig.json` references were completed to cover the scaffold's real dependency graph — the release-sync merge (c291e79) left these gaps hidden behind a stale incremental build, and any new apps/web test file exposed them.
