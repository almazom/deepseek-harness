# Agent Note: browser-video-record moved to the plugins fleet

Status: implemented

English | [中文](2026-09-20-browser-video-record-skill.zh.md)

## Problem

The annotated browser-video recording skill lived under `.agents/skills/` inside core checkouts, so every release tree carried its own copy. The fleet isolation law puts custom plugins and their recording tooling in the external plugins repository, and the core copy became an ownerless shadow that drifted from the fleet original.

## Decision

The skill is no longer maintained in this core checkout. Its canonical home is `~/projects/dsh/plugins/observability/dsh-almazom-browser-video-record/` — the fleet iron rule: custom plugins are isolated in the plugins repo, and the name describes the function and carries "almazom". User-facing doctrine stays at `~/.agents/skills/browser-video-proof/SKILL.md`; the MCP layer lives at `~/projects/dsh/plugins/observability/dsh-almazom-browser-video-mcp/`. Full history is preserved on the archive branch `dsh/almazom-skills-archive` at commit df6548a372. The convention decision is saved in OpenViking resources as `projects/dsh/conventions/2026-09-20-browser-proof-convention.md`.

## Alternatives considered

- **Keep the core checkout's copy synced with the plugins repo** — the copy had already drifted from the fleet original (recorded above), so a second home reproduces exactly the failure the isolation-law move ended.

## Consequences

- Do not recreate skill content under `.agents/skills/` in release checkouts.
- Recording-behavior changes go to the plugins-repo skill; this note stays a pointer, not documentation of the skill itself.
