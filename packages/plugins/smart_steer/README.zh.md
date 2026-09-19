---
description: "隔离的 Smart-steer 插件：模型驱动的队列顾问分发器、其上的 /side（别名 /btw）人类命令，以及两个会话投影，收拢在一个可整体挂载或省略的包里。"
kind: "package-reference"
---

# @deepseek-ai/dsh-smart-steer

[English](README.md) | 中文

## 概述

`dsh-smart-steer` 用一个隔离插件拥有用户与系统之间的整条 Smart-steer 建议面：模型驱动的 `queueAdvisor` 分发器、向它提出一个侧问的 `/side`（`/btw`）命令，以及双方读写与发布的两个会话投影（`advisor/run`、`smart_steer/latest-human`）。不带顾问配置的挂载只注册命令面；带显式 provider/model 路由的挂载还会构造分发器。建议运行把各阶段流入会话日志且从不改动代理历史；从建议结论回到队列的唯一桥梁是用户的显式动作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把根插件挂载到命令面所属之处——随附的 preset 是参照——并且只在需要分发器的地方传入顾问配置；随附的 Web profile 改为把 `./dispatcher` 入口作为其 `queue-advisor` 宿主服务挂载并带显式配置值。

### 挂载参照

| 行形态 | 效果 |
|---|---|
| `- id: smart-steer` 配 `name: '@deepseek-ai/dsh-smart-steer'` | 注册 `/side`、`/btw` 与 `smart_steer/latest-human` 投影；无分发器 |
| 同一行再加 `config`：成对的 `provider`/`model` 与五个数值上限 | 额外在 `ctx.queueAdvisor` 上构造 `QueueAdvisorService`；不完整配置在加载时响亮失败 |
| `name: '@deepseek-ai/dsh-smart-steer/dispatcher'` | 仅分发器服务，用于不得注册命令面的平面 |
| 浏览器名册行 `- id: smart-steer-client`（包名） | 将顾问界面注册进队列坞的 `conversation.input.dock.advisor` 插槽，并注册 `smart-steer` 语言字典 |

### 命令参照

| 输入 | 结果 |
|---|---|
| `/side <question>` | 对最新一条待发送排队消息连同输入的问题启动一次建议运行；直接结果点名目标消息 |
| `/btw <question>` | `/side` 的别名拼写，注册为接同一处理器的独立命令定义 |
| `/side`（无输入） | 用法错误：需要一个侧问 |
| 空队列时的 `/side <question>` | 对最近一条已送达的人类消息启动建议运行；尚无任何人类消息时，用法错误提示先发送一条消息 |
| 未挂载顾问时的 `/side <question>` | 直接报错并点明部署缺口 |

<a id="understand-the-implementation"></a>
## 理解实现

### 根插件

`src/index.ts` 以命名导出提供函数插件（`name: 'smart_steer'`、`inject: ['commands', 'sessionProjections']`）。`apply` 注册侧问命令片段，并且仅当挂载配置带成对的 provider/model 时才插入 `QueueAdvisorService`，让服务自身的必填字段 schema 校验完整策略。

### 宿主分发器

`src/dispatcher.ts` 默认导出 `QueueAdvisorService`，即模型驱动的侧问运行入口。会话控制器的 `advise` 队列动作——现有 `QueueAction` 联合的成员，因此没有新的 Remote 方法——解析这个可选服务并调用 `run({session, queuedItemId, queuedMessage})`；只有部署未挂载分发器时该调用才拒绝（客户端的一级表单兜底）。服务通过 `ctx.sessionQuery.readSession` 读取会话快照（无同步事件日志读取），追加品牌化 seq 成为 `runId` 的 `advisor/run-requested`，经 `AdvisorSectionWatcher` 流式消费辅助路由，并在每个分段闭合时追加 `advisor/step`、在结论合法时追加 `advisor/verdict`，或在流失败、超时、违反契约、请求事件之前的框架失败时追加 `advisor/failed`。

### 侧问命令

`src/side-command.ts` 注册共享同一处理器的两个 `CommandDefinition`（`side`、`btw`）——命令注册表没有别名概念，因此别名是第二次注册，两种拼写都会出现在发现 UI 中。处理器经严格服务存储解析可选的 `queueAdvisor` 服务，选取最新待发送条目（先 `nextTurn` 末尾，否则 `nextStep` 末尾），逐字拼接其文本块，并按与会话控制器 `advise` 动作完全一致的方式即发即忘地调用 `queueAdvisor.run`。空队列时处理器读取 `smart_steer/latest-human` 投影并把运行锚定到该消息 id，回退读取的是维护中的投影状态而非扫描历史事件。

### 投影词汇

本包向会话投影映射合并两个键。`advisor/run` → `AdvisorRunProjection | null` 把 `advisor/*` 事件折叠成整次运行的值：`status: 'running' | 'done' | 'failed'`、带逐字结论的已完成 `steps`，以及落定的 `verdict`；第二条 `advisor/run-requested` 会替换上一次运行。`smart_steer/latest-human` → `LatestHumanMessage | null` 是仅宿主的 `user/message` 事件折叠，保留最新一条非空直发人类提示；注入的上下文与仅附件消息永不符合。客户端面经标准投影座位读取这些键——不做客户端折叠。

### 建议框架

一次模型调用产出整个决策；系统提示中的固定键序把一条流变成四个可观察阶段（`tail`、`compare`、`risk`、`verdict`）。`AdvisorSectionWatcher` 是纯字符级状态机，在值的嵌套回到深度 1 时闭合分段，容忍未知键——由分发器把键映射到阶段并丢弃多余键——并通过 `finish()` 报告被截断的流而非抛错。`AdvisorLlmConfig` 没有默认值：五个数值上限框定快照与截止时间，未知键在加载时响亮失败，分发器拒绝任何不成对或缺失的 provider/model 组合。

### 客户端界面

`src/client/index.ts` 挂载浏览器半区：注册 `smart-steer` 语言字典，并把 `AdvisorSurface` 贡献进队列坞的 `conversation.input.dock.advisor` 插槽。该界面是队列坞交来的所有者共享数据的纯函数（打开/收起状态、被建议行的实事、置信度门槛、追问与立即发送回调）；它通过 `runAdvisorPipeline` 重算确定性的一级预判，并自行读取 `advisor/run` 实时投影。界面从不接触服务；省略名册行的部署只会让队列坞的智能按钮保持惰性，而不是报错。

### 源码地图

- `src/index.ts` — 合并后的根插件：导出、事件/投影映射合并、挂载语义。
- `src/config.ts` — 配置 schema 与解析器、快照框架构建器、`AdvisorSectionWatcher`。
- `src/types.ts` — 事件载荷、`AdvisorRunId`、`AdvisorStepId` 与部署策略类型。
- `src/advisor-projection.ts` — 纯 `advisor/run` 折叠单元及其状态/线格式 schema。
- `src/latest-human.ts` — `smart_steer/latest-human` 折叠单元及其校验后的状态。
- `src/side-command.ts` — `/side`（`/btw`）的注册与处理器。
- `src/client/` — 浏览器顾问界面（`AdvisorSurface`）、它所折叠的一级大脑（`advisor.ts`）、以及 `smart-steer` 语言字典。
- `src/dispatcher.ts` — `QueueAdvisorService` 插件：快照读取、运行事件、流分发、分段落位。

<a id="model-experience"></a>
## 模型体验

### 建议侧问请求

#### 模型看到什么

顾问模型收到固定系统指令（钉死四键 JSON 契约）与一条包含 JSON 快照的用户消息：排队消息、会话尾部与近期用户请求，按 `maxInputBytes` 限幅并优先丢弃最旧的尾部条目。结论按设计模型可见，且可从 `advisor/*` 事件重建。

#### Token 影响

建议请求按快照输入规模与 `maxOutputTokens` 消耗 token。它独立于主代理请求，从不向代理历史添加建议文本或框架。

#### KV Cache 影响

不使主请求失效。固定的系统指令可跨运行复用，JSON 快照随排队消息变化；辅助缓存的复用因提供商而异。

### 命令结果

#### 模型看到什么

什么也看不到。命令、其参数与结果都在仅日志的 `command/run`/`command/done` 记录中，没有任何建议文本进入代理历史。

#### Token 影响

零：不添加任何系统提示分段或工具 schema。

#### KV Cache 影响

零增长：本包不贡献系统提示内容，代理 KV 缓存不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- Web profile 以显式 `provider`/`model` 值挂载分发器入口；其他 profile 通过根插件行以同样的显式形态选择加入。
- 命令落定之后（顾问路由宕机）的启动失败只会以宿主警告日志加顾问表单缺席的方式浮现；命令结果已报告成功。把启动失败折进 `command/done` 纠正需要命令面尚未暴露的生命周期重放接缝。
- 别名以两个命令定义拼写，两者都会出现在命令发现中；注册表级别名概念推迟到第二个命令需要它时。
- 在无行运行启动之后、空队列表单收养它之前排队的新行，会让该运行没有可见表单；运行事件仍落入日志，排队行自己的智能按钮保持可用。
- 命令处理器在命令时刻读取队列，因此仍处于客户端提交回声（尚未服务端拼接）中的行会让命令回退到最近送达消息而不锚定该行；运行仍会启动，已提交的行保留其智能按钮。
- 队列智能按钮与顾问槽接线仍留在 `ui-conversation`；表单本身已是本包的客户端半边，把按钮移出 dock 属于后续拓扑整理。

### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

空队列回退锚点是本包自己的 `smart_steer/latest-human` 投影单元，由根插件的 `apply` 注册；更改其折叠语义必须提升 `stateVersion`。命令文案位于宿主代码而非客户端语言字典；只有顾问表单字符串例外。分段监视器报告任何闭合的顶层键而不只是四个契约键，因此添加键的提供商会退化成更少的可见阶段而非失败运行。不发布不变量伴随包：分发器与投影的关系已持久记录在会话日志中并由真实组合测试观察；没有独立运行时观察会与它们分歧。

</details>
