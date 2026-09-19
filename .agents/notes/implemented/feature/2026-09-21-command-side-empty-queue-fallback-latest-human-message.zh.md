# Agent Note: /side falls back to the latest human message on an empty queue

Status: implemented

[English](2026-09-21-command-side-empty-queue-fallback-latest-human-message.md) | 中文

- Kind: feature
- Scope: packages/session/command-side, packages/session/session-advisor-llm, packages/client/ui-conversation, apps/web
- Date: 2026-09-21
- Supersedes (partial): the empty-queue error arm of [/side (/btw) command as a second queueAdvisor consumer](2026-09-21-command-side-btw-alias-second-queueadvisor-consumer.zh.md), which stays active for the seam, alias spelling, and fire-and-forget semantics

## 问题

v1 的 `/side` 命令在队列为空时直接给出用法错误，于是这个命令恰好在操作者最需要它的时候不可用：回合之间、回合结束之后、或者从未排队过任何消息的时候。对实时会话的取证显示两次真实尝试都是这样失败的——一次发生在回合中途、还没有任何行入队时，一次发生在回合结束五分钟后、收件箱为空时。两次队列都确实是空的；错的是契约本身对旁路提问何时有意义的判断。旁路提问需要一条可供顾问的消息，而只要操作者说过话，对话日志里就一定有一条。

## 决策

队列为空时，命令处理器读取本包自有的 `command-side/latest-human` 会话投影单元，并以它持有的消息锚定顾问运行——运行仍经未改动的 `queueAdvisor.run` 缝启动，消息 id 放进既有的 `queuedItemId` 载荷字段，消息文本作为 `queuedMessage`。该单元是对 `user/message` 事件的主机侧折叠，保留来源 kind 为 `user` 且拼接文本块非空的最新一条，因此回退读取的是维护中的投影状态——同步读取历史事件对新调用已弃用，投影状态是认可的替代；注入的上下文（`user` 以外的来源 kind）与纯附件消息不会入选。调度器、`SessionEventMap`、投影与 `SESSION_FORMAT_VERSION` 均未触碰。错误只对完全没有已送达人类消息的会话保留，措辞改为 "No message to advise about yet: send a message first, then ask again."。成功文案标明目标：排队路径为 "for queued message"，回退路径为 "for the latest message"。

在客户端，`QueueDock` 的顾问状态从队列行变为 `AdvisingAnchor { id, preview, rowless }`：排队路径由待处理行填充，自动打开效果新增一个以 `rowCount === 0` 为门槛的 rowless 分支——锚不到任何待处理行的运行只在队列为空时被采纳，锚定行的运行保持原有的清空行清理语义。曾被待处理行支撑过的运行 id（无论经采纳还是经智能按钮）会被记住，因此它后续的清行会关闭面板，而不是把同一运行重新按 rowless 采纳。顾问表面——迷你条 portal 与面板——提升到 dock 的空队列门之上，因此面板在空队列时照常渲染，而不是 dock 返回 null。`AdvisorSurface` (smart_steer client half; formerly ui-conversation `AdvisorSurface`) 接收必填的 `rowless` 属性，rowless 运行下隐藏保留在队列/立即发送的页脚动作、置信度门槛行与追问输入框，并把被顾问消息的标签显示为"顾问对象"（Advising about）；收起/展开与关闭控件保留。

## 被否决的替代方案

- 让命令调用 `sessionQuery` 服务来寻找锚点——否决：`SessionQueryEngine` 是抽象类，harness 中没有具体提供者，命令将因此需要新服务加提供者，而命令运行处本就挂载着投影注册表。
- 通过 `session.snapshotEvents()` 直接同步扫描日志——实现前即否决：[弃用决策](../architecture/2026-09-09-deprecate-synchronous-session-event-reads.zh.md)禁止对同步历史读取器的新调用，扫描会让命令依赖完整事件序列常驻内存。
- rowless 面板保留投递动作并把行显示为"0 条排队"——否决：保留在队列与立即发送作用于一条不存在的队列行；渲染它们只会招致必然失败或误导的操作。
- 不看队列状态一律采纳 rowless 运行——否决：锚定行的运行在其行 id 已不在队列时会静默地按 rowless 采纳；`rowCount === 0` 门槛正是保住既有清空行行为的关键。

## 后果

- `/side` 在回合之间和任何队列出现之前都可用；错误只对没有任何已送达人类消息的全新会话保留。
- 每会话单一投影槽仍是最新运行胜出，关闭仍以运行 id 为键，因此被显式关闭的 rowless 运行在其投影存续期间保持关闭。
- 处理器在命令时刻读取队列；因此改写后的 e2e 在调用 `/btw` 前先等待排队行的服务端 `agent/inbox/spliced`，因为 dock 会在拼接提交之前渲染客户端提交回显。
- 命令的直接输出文案没有 recorded-session 快照属主（已对 `snapshots/` 搜索验证），因此无需刷新快照；改写后的 `apps/web/tests/advisor-side-command.e2e.ts` 在 `DSH_SNAPSHOT=replay` 下端到端钉住回退：rowless 成功卡片、rowless 面板形态、Escape，随后是带完整投递动作的行运行。
- 固定的顾问系统提示未改动；rowless 运行以 `queuedMessage` 框架接收锚定消息，而 `/side` 总是携带键入的问题，追问框架规则不受影响。
- [面板交互回路](2026-09-21-advisor-side-runtime-sheet-interaction-loop.zh.md)笔记保持有效；rowless 面板是同一交互回路的附加模式。

## 测试

- `packages/session/command-side/tests/command-side.spec.ts`：回退到最新人类消息、注入上下文与纯附件跳过、无人类消息错误、以及不变的行优先级。
- `packages/client/ui-conversation/tests/queue-dock.client.spec.tsx`：空队列下 rowless 自动打开的精简面板形态、被关闭的 rowless 运行保持关闭、有行排队时不采纳，以及清空行后的锚定行运行保持关闭而不以 rowless 重开。
- `pnpm run verify-client-ui-i18n` 覆盖新的本地化键；双语笔记与 README 的配对门在 doc-sync 中运行。
