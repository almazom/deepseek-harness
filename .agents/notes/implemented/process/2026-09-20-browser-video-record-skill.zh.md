# Agent Note：browser-video-record 已迁移至 plugins 车队（2026-09-20）

Status: implemented

[English](2026-09-20-browser-video-record-skill.md) | 中文

## 问题

带注释的浏览器视频录制技能此前住在 core checkout 的 `.agents/skills/` 下，于是每个 release tree 都携带自己的一份副本。车队隔离法要求自定义插件及其录制工具隔离在外部 plugins 仓库，core 里的副本因此成了无主的、与车队原件漂移的影子。

## 决策

该技能不再在此 core checkout 中维护。其唯一正源是 `~/projects/dsh/plugins/observability/dsh-almazom-browser-video-record/`——车队铁律：自定义插件隔离在 plugins 仓库，名称描述功能并携带 "almazom"。面向用户的doctrine 保持在 `~/.agents/skills/browser-video-proof/SKILL.md`；MCP 层位于 `~/projects/dsh/plugins/observability/dsh-almazom-browser-video-mcp/`。完整历史保留在归档分支 `dsh/almazom-skills-archive` 的 commit df6548a372 上。约定决定已存入 OpenViking resources：`projects/dsh/conventions/2026-09-20-browser-proof-convention.md`。

## Alternatives considered

- **在 core 保留一份与 plugins 仓库同步的副本** — 一个技能两个家，恰好重演隔离法要消除的漂移；拒绝。
- **删除历史而不保留归档分支** — 分支维护零成本且为后来的读者保留来源；删除被拒绝。

## Consequences

- 不要在 release checkout 的 `.agents/skills/` 下重建技能内容。
- 录制行为的变更进入 plugins 仓库的技能；本笔记只是指针，不是技能本身的文档。
