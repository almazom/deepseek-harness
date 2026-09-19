# Agent Note: Smart-steer 表面隔离进 smart_steer 插件

Status: implemented

[English](2026-09-21-smart-steer-isolated-plugin.md) | 中文

- Kind: architecture
- Scope: packages/plugins/smart_steer, packages/session, packages/api/session-controller, packages/client/ui-conversation, packages/bundle, packages/preset
- Date: 2026-09-21
- Supersedes (structural): [empty-queue fallback 笔记](../feature/2026-09-21-command-side-empty-queue-fallback-latest-human-message.zh.md)的双包布局；其行为契约原样并入合并后的包

## Problem

Smart-steer 表面分散在两个 `packages/session/` 包里——`session-advisor-llm` 调度器与 `command-side` 命令——两者之间的接缝表现为跨包导入和五条独立的挂载行。该表面在用户与系统之间是一个产品单元：同一个部署决策（此部署是否为 side 问题提供建议？）同时约束两个包，但挂载它们意味着维护两个 plugin id、两条依赖行，以及一对命名实现细节而非产品的名字（`@deepseek-ai/dsh-session-advisor-llm`、`@deepseek-ai/dsh-command-side`）。分组位置也夸大了它们的角色：两个包都不是会话数据平面；它们消费数据平面。

## Decision

一个隔离的插件取代两者：`packages/plugins/smart_steer/`，npm 名 `@deepseek-ai/dsh-smart-steer`，cordis 插件名 `smart_steer`。该包拥有调度器服务（`./dispatcher` 子路径，default-export 的 `QueueAdvisorService`，保持不变）、`/side`/`/btw` 命令片段，以及两个投影单元——`advisor/run` 不变，fallback 投影从 `command-side/latest-human` 改名为 `smart_steer/latest-human`（键由包拥有，特性未发布，投影状态从事件日志折叠重建，因此没有任何已提交的代际需要迁移）。根 function 插件注册命令表面加两个投影，并且仅当挂载配置携带成对的 provider/model 时才构造调度器：preset 以无配置方式挂载并得到命令表面，而 Web profile 继续把 `./dispatcher` 入口挂载为宿主服务 `queue-advisor`——同一套已验证可行的拓扑，只是用包名重新表述。`session-controller` 的 advise 接缝保持严格的 `ctx.get('queueAdvisor')` 查找，服务缺失时降级；插件对所有消费者都是可选的，包括客户端——客户端 advisor sheet 类型现在从新的说明符导入，行为无变化。旧包被删除（git mv 保留历史），`plugins/` 组以一条有记录的 subsystem 页面豁免映射新单元；投影改名记录在包 README 中而非迁移文档里，因为没有已发布的会话格式携带旧键。

## Alternatives considered

- 在所有地方使用单一合并的插件入口（root 插件在 Web 宿主平面也带配置）——暂时否决：这会在宿主平面注册命令表面，而 shipped patch 层有意在那里禁用它，因为命令归 preset 所有；合并两条挂载入口属于后续的拓扑整理。
- 在新组下保留两个包——否决：那会保留跨包导入和双名接缝，而这正是隔离要消除的分散。
- 保留 `command-side/latest-human` 键——否决：键由包拥有，特性在同一发布周期内交付，投影状态通过折叠日志重建，改名没有成本，也不会在隔离后的包里留下旧名残留。

## Consequences

- 消费者：`session-controller` 与 `ui-conversation` 从 `@deepseek-ai/dsh-smart-steer` 导入类型；`session-controller` 的服务查找保持不变且插件可选。
- 挂载：base bundle 与 `ptc`/`standard`/`cordis` preset 挂载根插件（id `smart-steer`，无配置）；Web patch 在宿主平面禁用该 id，并以显式配置把 `@deepseek-ai/dsh-smart-steer/dispatcher` 挂载为 `queue-advisor`。
- 测试：五个迁移的 spec 文件在包内运行（46 个测试），加上消费者套件；loader composition 证明现在启动新的包名。
- Deferred（已被取代）：客户端 advisor sheet 与队列智能按钮后来通过客户端扩展点移入本插件——参见[客户端半隔离笔记](2026-09-19-smart-steer-client-half-isolation.zh.md)。
