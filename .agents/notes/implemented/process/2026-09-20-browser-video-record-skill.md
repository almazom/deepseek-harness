# Agent Note: browser-video-record moved to the plugins fleet (2026-09-20)

The annotated browser-video recording skill is NO LONGER maintained in this core
checkout. Canonical home (fleet iron rule: custom plugins isolated in the plugins
repo, name describes function + carries "almazom"):

    ~/projects/dsh/plugins/observability/dsh-almazom-browser-video-record/

Do not recreate skill content under .agents/skills/ in release checkouts. User-facing
doctrine: ~/.agents/skills/browser-video-proof/SKILL.md. MCP layer:
~/projects/dsh/plugins/observability/dsh-almazom-browser-video-mcp/. History:
archive branch `dsh/almazom-skills-archive` at df6548a372. Convention note saved in
OpenViking resources: projects/dsh/conventions/2026-09-20-browser-proof-convention.md.
