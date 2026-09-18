---
description: "面向配置 Smart-steer 队列顾问或调试建议运行的用户与维护者的模型化建议运行共享策略。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-advisor-llm

[English](README.md) | 中文

Smart-steer 队列顾问单次运行的共享框架、分段流式、超时与校验策略：一次模型驱动的侧问对话，读取当前会话的只读快照，回答"这条排队消息现在该发还是该留"。

## 概述

顾问针对每条排队消息回答一个问题——"这条消息现在打断正在运行的回合是否安全"——依据只读快照：排队消息、会话尾部、近期用户请求。模型契约输出一个 JSON 对象，其顶层键 `tail`、`compare`、`risk`、`verdict` 按此顺序闭合；`AdvisorSectionWatcher` 在每个键的值闭合瞬间上报，宿主代码即可在流仍在输出时逐阶段写入 `advisor/step` 事件。运行过程绝不改动主智能体循环；从裁决回到队列的唯一桥梁是用户的显式操作。

## 目录

- [Use this package](#use-this-package)
  - [Events](#events)
  - [Configuration](#configuration)
  - [Host dispatcher](#host-dispatcher)
- [Understand the implementation](#understand-the-implementation)
  - [Design concept](#design-concept)
  - [Source map](#source-map)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>

## 使用本包

<a id="events"></a>

### 事件

本包向 `SessionEventMap` 合并三个读取必答的事件类型：

| 事件 | 载荷 | 作用 |
| --- | --- | --- |
| `advisor/run-requested` | `AdvisorRunRequestedEventData` | 仅入日志的分发前记录：精确的系统提示、快照消息、路由、token 上限。 |
| `advisor/step` | `AdvisorStepEventData` | 一个完成的阶段（`tail`、`compare`、`risk`、`verdict`），附模型原样结论。 |
| `advisor/verdict` | `AdvisorVerdictEventData` | 最终 `send-now` / `hold` 裁决，含模型给出的置信度。 |
| `advisor/failed` | `AdvisorFailedEventData` | 运行在结论前终止：流失败、超时、违反约定，或请求事件记录前的取帧失败（此时 `runId` 为 null）。 |

建议提示与发现按设计即模型可见，且可由这些事件重建（model-visible ⟺ logged）。客户端的实时运行展示读取这些事件；不得重新推导发现。客户端将模型置信度与自身的 `smartSteerMinConfidence` 门槛比较——门槛不再记入日志载荷。

<a id="configuration"></a>

### 配置

`AdvisorLlmConfig` 为必填、无默认值：`maxInputBytes`（应用于完整快照帧的 UTF-8 上限，优先丢弃最旧的尾部条目）、`maxOutputTokens`、`timeoutMs`（单次运行端到端截止）、`tailEntries` 与 `recentRequests`（快照取帧宽度），以及成对的 `provider`/`model` 路由覆盖。分发前先经 `resolveAdvisorLlmConfig` 解析；未知键在加载时即响亮失败。建议策略容忍路由缺失，而分发器服务在加载时拒绝任何不成对或缺失的路由（配置错误响亮失败）。

<a id="understand-the-implementation"></a>

## 理解实现

<a id="design-concept"></a>

### 投影词汇

本包向会话投影映射合并一个键：`advisor/run` → `AdvisorRunProjection | null`。`src/projection.ts` 中的纯折叠单元把 `advisor/*` 事件折成整运行值：`status: 'running' | 'done' | 'failed'`、已完成的 `steps` 及逐字发现、以及最终 `verdict`；第二次 `advisor/run-requested` 替换上一次运行，首次运行之前值为 `null`。分发器在挂载时注册该单元，释放时移除。客户端表面通过标准 `useProjection` 座位读取该键——客户端不做折叠。

<a id="host-dispatcher"></a>

### 宿主分发器

`src/dispatcher.ts` 默认导出 `QueueAdvisorService`，即模型侧问运行的入口。会话控制器的 `advise` 队列动作——既有 `QueueAction` 联合的成员，因此无需新的 Remote 方法——解析此可选服务并调用 `run({session, queuedItemId, queuedMessage})`；仅当部署未挂载分发器时该调用才拒绝（客户端保留 tier-1 面板）。服务经 `ctx.sessionQuery.readSession` 读取对话快照（不做同步事件日志读取），先记录 `advisor/run-requested`（其带品牌 seq 即 `runId`），再通过 `AdvisorSectionWatcher` 流式调用辅助路由，并按闭合节记录 `advisor/step`，结论合乎约定时记录 `advisor/verdict`，流失败、超时、违反约定或请求事件记录前的取帧失败时记录 `advisor/failed`。分发器不属于已发布 profile 默认挂载；是否挂载由部署在 `cordis.yml` 中以显式配置值声明。

### 设计概念

一次模型调用产出完整决策；系统提示中的固定键序把一条流变成四个可观测阶段。观察器是纯字符级状态机（嵌套深度、字符串与转义状态），在值的嵌套回落到深度 1 的边界、或最后一段在根括号处闭合该段。它容忍未知键——把键映射到固定的 `AdvisorStepId` 阶段并丢弃其余是分发器的职责——并以 `finish()` 报告被截断的流而不抛错。

<a id="source-map"></a>

### 源码地图

- `src/types.ts` — 事件载荷、`AdvisorRunId`、`AdvisorStepId` 及部署策略类型。
- `src/index.ts` — `SessionEventMap` 合并、配置模式与解析器、`buildAdvisorMessages`（字节受限的快照帧）、`buildAdvisorSystemPrompt`（固定的分段契约）、`AdvisorSectionWatcher`。
- `src/projection.ts` — `advisor/run` 纯折叠单元及其状态/线缆模式。
- `src/dispatcher.ts` — `QueueAdvisorService` 插件：快照读取、运行事件、流分发与分段落地。

<a id="model-experience"></a>

## 模型体验

### 建议侧问请求

#### 模型看到什么

顾问模型接收固定的系统指令（约定 `tail`、`compare`、`risk`、`verdict` 四键 JSON 契约）与一条用户消息（JSON 快照：排队消息、会话尾部、近期用户请求，受 `maxInputBytes` 限制，优先丢弃最旧尾部条目）。

#### Token 影响

建议请求按快照输入规模与 `maxOutputTokens` 消耗 token。它独立于主智能体请求，绝不向智能体历史添加顾问文本或框架；可见的运行过程记录在 `advisor/*` 会话事件中。

#### KV Cache 影响

不使主请求缓存失效。固定的系统指令可跨运行复用，而 JSON 快照随排队消息变化；辅助缓存复用与提供方相关。

## 已知限制与延期工作

- Web profile 以显式 `provider`/`model` 值挂载 `QueueAdvisorService`；其他 profile 通过 `cordis.yml` 行以同样的显式形态选择加入。

### 开发备注

观察器上报任何已闭合的顶层键，而不只是四个契约键：把键映射到 `AdvisorStepId` 阶段由分发器负责，这样增加键的提供方只会退化为更少的可见阶段，而不是运行失败。

- No invariant companion is published: 关系由会话日志持久记录并被真实组合的调度器测试直接观察，不存在能与之分歧的独立运行时观察。
