# Agent Note：建议侧问分发器复用既有队列动作

Status: implemented

[English](2026-09-18-advisor-side-run-dispatcher-rides-queue-action.md) | 中文

- Kind: architecture
- Scope: packages/session/session-advisor-llm, packages/api/session-controller, packages/core/session, packages/client/ui-conversation
- Date: 2026-09-18

## 问题

`advisor/*` 事件词汇、纯 `advisor/run` 折叠与客户端实时分支均已就绪，却没有产生任何运行：事件没有生产者，`gateThreshold` 仍在日志载荷中重复客户端的置信度门槛，也没有宿主路径把 Smart-steer 按钮点击变成 /btw 模式所需的模型侧问。

## 决策

触发器是既有 `QueueAction` 联合上的新成员 `advise`，走既有 `updateQueue` Remote 方法："advise" 是一次队列操作（只读），而新的 Remote 方法只会为同等能力重复这四文件主线。会话控制器的 `updateQueue` 开关解析可选的 `queueAdvisor` 服务，部署未挂载时抛 `session/advisor-unavailable`，客户端因此保留 tier-1 面板。`session-advisor-llm` 新增 `src/dispatcher.ts`（默认导出 `QueueAdvisorService`）与 `src/projection.ts`（此前只被描述、从未发布的折叠单元）。分发器经 `ctx.sessionQuery.readSession` 读取快照——这是获批的异步读取——而不是已弃用的同步 `Session.snapshotEvents`；它先记录 `advisor/run-requested`（其带品牌 seq 即 `runId`），按闭合节记录 `advisor/step`，并以 `advisor/verdict` 或 `advisor/failed` 结算（第四种事件类型；流失败、超时，以及结论节或流级违反约定落在那里；格式错误的发现节被丢弃，请求事件记录前的取帧失败以 null `runId` 落在那里）。`gateThreshold` 从 `AdvisorVerdictEventData` 与 `AdvisorRunVerdict` 中移除：客户端的 `smartSteerMinConfidence` 是门槛的唯一属地，部署可以在不改写历史的情况下重调门槛。投影值是 `AdvisorRunProjection | null`，客户端据此用 `!= null` 比对被建议的行。

## 曾考虑的替代方案

- 专用的 `advise` Remote 方法——否决：它会复述 `updateQueue` 的按项动作主线，而队列联合本就枚举了调用方的逐项动词。
- 消息入队即自动运行顾问——否决：这会在没有用户意图的情况下消耗模型调用，且违背"显式用户动作启动侧问"的 /btw 规则；只有按钮点击（或未来的显式入口）才触发运行。
- 从已记录的请求头重折路由而不是用配置——否决：辅助建议路由与任何模型路由一样是部署选择；从历史推导会把运行与恰巧服务主回合的路由耦合。
- 尾部读取保留 `snapshotEvents`——被"弃用同步会话事件读取"决策否决；session-query 读取是以同样观测语义的异步替代。

## 后果

- tier-1 预判与实时运行共享一条触发路径；智能按钮现在总是向宿主请求侧问，断言"打开即无投递"的规格改为断言只读的 `advise` 调用。
- Web profile 以显式 `provider`/`model` 值（对齐默认智能体路由）挂载 `QueueAdvisorService`，智能按钮在该表面执行侧问；其他 profile 在选择加入之前以 `session/advisor-unavailable` 拒绝。挂载形态（insert 行 + 显式 `provider`/`model`）双重钉住：本包的 real-composition Loader 测试，以及一条 Web e2e——它让脚本化的建议运行流过已发布组合，并观察表单的各阶段从日志投影逐步完成。
- `advisor/failed` 使整个建议生命周期可从日志重建：重放的日志产生完全相同的投影，无需宿主侧重算。
- 挂载分发器会在每个 Web profile 会话注册 `advisor/run` 投影单元，这会可测量地拖慢共享事件管道：挂载该行后，两个阈值敏感的 web e2e（`sidebar-right`、`chat-scroll-contract`）单独运行也失败，而在 HEAD 或移除该行时通过，且打包产物字节完全一致。对每事件成本（折叠、wire 视图或客户端订阅）的性能剖析与这两个 spec 的阈值重调是后续工作；建议功能自身的 spec 在挂载该行时全部通过。
