# Agent Note: Smart-steer 客户端表面迁入 smart_steer 插件

Status: implemented

[English](2026-09-19-smart-steer-client-half-isolation.md) | 中文

- Kind: architecture
- Scope: packages/plugins/smart_steer, packages/client/ui-conversation, packages/bundle/web-app
- Date: 2026-09-19

## Problem

Smart-steer 包拥有建议功能的宿主半边（调度器、`/side` 命令、投影），但它的客户端表面——`AdvisorSheet` 组件、`queue/advisor.ts` 里的确定性 tier-1 大脑、peek pill，以及整套 `advisor.*` 词典——都住在 `packages/client/ui-conversation` 里。省略 smart_steer 插件的部署仍然发布建议 UI 的每一个字节；包 README 里"隔离插件可被部署整体挂载或整体省略"的说法只对了一半。

## Decision

队列 dock 只保留槽：`conversation.input.dock.advisor`（名字按客户端槽规则镜像组合路径；kanban 卡片的 `queue:advisor-sheet` 拼写为合规而改名）。这是一个 `single`/`session` 槽，其 owner 份额（`AdvisorOwnerProps`，由插件的 `src/client/owner.ts` 拥有，它对 SlotMap 做声明合并）只携带原始事实与回调——open/peek 状态、被建议行的预览、`minConfidence`、live-running 标志，以及 `followUp`/`onSendNow`/`onCollapse`/`onExpand`/`onClose` 回调。dock 不再导入 sheet、大脑、`createPortal` 或 advisor 词典键；`lastHumanPreview` 留在 `ui-conversation` 的 `queue/preview.ts`，因为它折叠插件从不接触的会话记录。

smart_steer 包在 `src/client/` 下获得客户端半边，带 `./client` 导出与 `dsh.client` web manifest：`index.ts` 注册 `smart-steer` 词典命名空间并把 `AdvisorSurface` 注入槽；`AdvisorSurface.tsx` 把 peek pill（portal 到 `document.body`，所以能在隐藏的 dock 之外存活）或 sheet 渲染为 owner 份额的纯函数，通过迁移过来的 `runAdvisorPipeline` 重算 tier-1 预判，并自行读取 live 的 `advisor/run` 投影。`advisor/*` 词典键整体移入插件命名空间；sheet 自己裁剪追问文本，因为 dock 现在逐字转发 composer 文本。

仅类型的接缝保持两面的诚实：槽契约归插件所有——`src/client/owner.ts` 声明 `AdvisorOwnerProps` 份额并对 `@deepseek-ai/dsh-client-ui-slots` 做声明合并，插件客户端面在投影/事件映射合并之外再导出 `AdvisorRunProjection` 类型，因此 `ui-conversation` 只引用 smart_steer 的**客户端**叶子；没有任何边从插件指回 `ui-conversation`。`session-controller` 的宿主聚合引用出于同样的 composite 规则原因移到了宿主叶子。web bundle 的浏览器 roster 新增一行 `smart-steer-client`；卸载它之后 dock 的智能按钮仍在但处于惰性状态。

## Alternatives considered

- 把 sheet 留在 ui-conversation、让插件通过服务驱动它——否决：包间行为只允许经过 slots/services/UI，而通过服务驱动的 UI 组件正是隔离阶段要移除的耦合。
- 让 dock 在运行时从 `@deepseek-ai/dsh-smart-steer` 导入大脑——否决：function 插件不得在运行时导入另一个 function 插件；dock 改为上报事实，由插件计算。
- 把 SlotMap 条目与 owner 份额类型留在 `ui-conversation` 的 `contract/slots.ts`——当插件客户端面为槽条目引用 `ui-conversation`、而 dock 又为 sheet 引用插件时，这一对构成了 composite 检测器拒绝的 project-reference 环；把槽契约移入插件（它拥有 advisor 词汇）让 `ui-conversation` 只剩一条出边。

## Consequences

- 测试所有权跟随代码：13 个大脑测试迁到 `packages/plugins/smart_steer/tests/advisor.client.spec.ts`，4 个 `lastHumanPreview` 测试留在 `ui-conversation` 成为 `preview.client.spec.ts`；dock spec（46 个测试）通过 `renderSlot` mock 断言 owner 份额契约，而不是 DOM sheet 输出。
- ui-theme 的 elevated-surface 门现在在插件 sheet 里看到 peek pill 的 `--dsw-alias-bg-layer-2`，所以 `AdvisorSurface.module.css` 携带了原 dock 样式表贡献的 scrollbar-color 重绑定。
- `verify-client-packages` 把 smart_steer 计为第 52 个客户端包（其 `dsh.client` manifest 是 plugins 组里第一个在 `packages/client/` 之外的）；`verify-cordis-config` 校验新的 roster 行，文档槽树列出子槽。
- 省略插件的部署现在真正不发布任何建议 UI；只省略客户端 roster 行的部署保持宿主半边完全可用。
