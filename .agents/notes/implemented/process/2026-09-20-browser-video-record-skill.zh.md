# Agent Note：browser-video-record 已迁移至 plugins 车队

Status: implemented

[English](2026-09-20-browser-video-record-skill.md) | 中文

## 问题

带注释的浏览器视频录制技能此前住在 core checkout 的 `.agents/skills/` 下，于是每个 release tree 都携带自己的一份副本。车队隔离法要求自定义插件及其录制工具隔离在外部 plugins 仓库，core 里的副本因此成了无主的、与车队原件漂移的影子。

## 决策

该技能的正源是车队 plugins 仓库中的 `observability/dsh-almazom-browser-video-record/`：隔离法把自定义插件及其工具留在仓库里，名称描述功能并携带「almazom」。面向操作者的准则位于 `~/.agents/skills/browser-video-proof/` 的 `browser-video-proof` 技能；MCP 层在同一仓库的 `observability/dsh-almazom-browser-video-mcp/`。已移除的 core 副本的完整历史保留在 `dsh/almazom-skills-archive` 分支上。

## 曾考虑的替代方案

- **在 core checkout 保留与 plugins 仓库同步的副本** — 该副本此前已经相对车队原件发生漂移（见上文），第二个家恰好重演隔离法迁移所终结的失败。

## 后果

- 技能只有一个归属方，release checkout 不再会长出偏离它的副本。
- 录制浏览器会话现在需要 plugins 仓库在场：全新的 core checkout 不携带技能，其门禁也不再覆盖录制行为。
- 不要在 release checkout 的 `.agents/skills/` 下重建技能内容；行为变更进入 plugins 仓库的技能，本笔记只是指针，不是技能本身的文档。
