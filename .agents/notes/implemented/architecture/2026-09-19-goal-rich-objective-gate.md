# Agent Note: Goal domain gains a deployment-configurable rich-objective gate

Status: implemented

English | [中文](2026-09-19-goal-rich-objective-gate.zh.md)

## Problem

The fleet goal-flow pipeline formulates every loop goal with a verifiable acceptance criterion and a visible round budget, but the goal domain admitted any non-empty objective. Every creation consumer — the model-facing `create_goal` tool path, `edit`, the `/goal` command, and the Typert remote — could commit a one-line goal to the goal panel.

## Decision

Enforce the admission floor inside the goal domain, the one choke point every creation consumer shares. New validated config: `requireRichObjective` (default `false`) and `minObjectiveChars` (default `80`). With the gate on, `create` and `edit` reject an objective below the length floor, without a verifiable acceptance clause, or — when the request names no round cap — without a visible budget clause. The rejection carries the stable `GOAL_OBJECTIVE_TOO_WEAK` code and names the missing pieces in an SGT-1-shaped reformulation hint; an explicit request-level `maxGoalRounds` satisfies the budget clause. Consumers stay thin, and the remote path cannot bypass the floor.

### Notes

- The gate defaults off: existing fleets and tests admit short objectives; pipeline deployments opt in through composition config.
- Model-visible tool descriptions and system-prompt guidance stay untouched (that text is pinned verbatim across recorded-session snapshots); the instructive rejection teaches the shape at runtime, and the `goal-expert`/`goal-flow` skills own the pre-create quality layer (enrichment waves) above this mechanical floor.

## Alternatives considered

- **Per-consumer checks in the tool schema, `/goal` command, and remote prompt** — every direct caller bypasses them; the admission rule must bind the operation that creates the goal, and the domain is the one code path all creation consumers share ([enforce-at-the-operation rule](../../../../packages/AGENTS.md)).
- **Skill-layer prompt guidance only** — keeps the domain permissive, so a one-line goal still reaches the panel from any consumer; enrichment stays the layer above this floor, not a replacement for it.
- **Model-judged admission scoring** — costs a request, an API key, and nondeterminism per create; the mechanical clause floor stays keyless and unit-testable, and judgement remains in the skills.

## Consequences

- Bought: no creation consumer, including the Typert remote, can commit an objective below the floor, and the `GOAL_OBJECTIVE_TOO_WEAK` hint teaches the SGT-1 shape at rejection time instead of through prompt text that snapshots pin verbatim.
- Cost: the clause floor is keyword-based — the tests pin negated ("unverified"), inflected ("judgement"), and prefixed ("re-verified") stuffing as rejected, but novel weak phrasings that carry the keywords still pass, so the skill layer remains the real quality gate.
- Cost: two more validated config fields and one model-visible hint string whose wording snapshots can pin.
