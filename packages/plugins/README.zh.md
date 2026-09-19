---
description: "plugins 组的组图：隔离的自包含产品插件，拥有用户与系统之间一整块产品面，并可整体挂载或省略。"
kind: "package-group"
---

# packages/plugins

[English](README.md) | 中文

## 摘要

plugins 组收纳隔离的自包含产品插件：每个包拥有一整块产品面——其服务、其人类命令及其投影——因此部署可以整体挂载或省略该单元，而无需把这块面散落到核心各组。这里的包可以消费可选的核心服务但从不扩展它们；组边界就是本页所绘的隔离契约，每个包的 README 拥有其包级契约。

## 目录

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`smart_steer`](smart_steer/README.zh.md) | Smart-steer 建议面：模型驱动的 `queueAdvisor` 分发器、`/side`（`/btw`）命令，以及 `advisor/run` + `smart_steer/latest-human` 投影 | `ctx.queueAdvisor`（可选），注册于 `ctx.commands` |

<a id="related-documentation"></a>
## Related documentation

- [Smart-steer 插件](smart_steer/README.zh.md) — 挂载行、命令参照与建议运行契约。
- [Session 子系统](../session/README.zh.md) — 本组赖以构建的会话数据平面：事件日志与投影注册表。
- [Profile bundles](../bundle/README.zh.md) — 把这些插件挂载进随附 profile 的补丁层。

<a id="dev-note"></a>
## Dev Note

None.
