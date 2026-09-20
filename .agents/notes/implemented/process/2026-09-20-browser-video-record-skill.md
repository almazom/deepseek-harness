# Agent Note: browser-video-record moved to the plugins fleet

Status: implemented

English | [中文](2026-09-20-browser-video-record-skill.zh.md)

## Problem

The annotated browser-video recording skill lived under `.agents/skills/` inside core checkouts, so every release tree carried its own copy. The fleet isolation law puts custom plugins and their recording tooling in the external plugins repository, and the core copy became an ownerless shadow that drifted from the fleet original.

## Decision

The skill's canonical home is the fleet plugins repository, under `observability/dsh-almazom-browser-video-record/`: the isolation law keeps custom plugins and their tooling there, and the name describes the function and carries "almazom". Operator-facing guidance stays in the `browser-video-proof` skill at `~/.agents/skills/browser-video-proof/`, and the MCP layer lives at `observability/dsh-almazom-browser-video-mcp/` in the same repository. Full history of the removed core copy stays on the `dsh/almazom-skills-archive` branch.

## Alternatives considered

- **Keep the core checkout's copy synced with the plugins repo** — the copy had already drifted from the fleet original (recorded above), so a second home reproduces exactly the failure the isolation-law move ended.

## Consequences

- The skill has one owner, so a release checkout can no longer grow a copy that drifts from it.
- Recording a browser session now needs the plugins repository present: a fresh core checkout carries no skill, and its gates no longer cover recording behavior.
- Do not recreate skill content under `.agents/skills/` in release checkouts; behavior changes go to the plugins-repo skill, and this note stays a pointer rather than documentation of the skill itself.
