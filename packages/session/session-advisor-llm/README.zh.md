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
| `advisor/verdict` | `AdvisorVerdictEventData` | 最终 `send-now` / `hold` 裁决，含置信度及其比对所用的门槛值。 |

建议提示与结论按设计即模型可见，且可由这些事件重建（model-visible ⟺ logged）。客户端的实时运行展示读取这些事件；不得重新推导结论。

<a id="configuration"></a>

### 配置

`AdvisorLlmConfig` 为必填、无默认值：`maxInputBytes`（应用于完整快照帧的 UTF-8 上限，优先丢弃最旧的尾部条目）、`maxOutputTokens`、`timeoutMs`（单次运行端到端截止），以及可选的成对 `provider`/`model` 路由覆盖。分发前先经 `resolveAdvisorLlmConfig` 解析；未知键在加载时即响亮失败。

<a id="understand-the-implementation"></a>

## 理解实现

<a id="design-concept"></a>

### 设计概念

一次模型调用产出完整决策；系统提示中的固定键序把一条流变成四个可观测阶段。观察器是纯字符级状态机（嵌套深度、字符串与转义状态），在值的嵌套回落到深度 1 的边界、或最后一段在根括号处闭合该段。它容忍未知键——把键映射到固定的 `AdvisorStepId` 阶段并丢弃其余是分发器的职责——并以 `finish()` 报告被截断的流而不抛错。

<a id="source-map"></a>

### 源码地图

- `src/types.ts` — 事件载荷、`AdvisorRunId`、`AdvisorStepId` 及部署策略类型。
- `src/index.ts` — `SessionEventMap` 合并、配置模式与解析器、`buildAdvisorMessages`（字节受限的快照帧）、`buildAdvisorSystemPrompt`（固定的分段契约）、`AdvisorSectionWatcher`。

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

- 队列顾问的宿主侧分发器（接线 LLM 服务的插件、运行事件与控制器命令）随其消费方落地；本包交付其所需的共享策略与分段观察器。

### 开发备注

观察器上报任何已闭合的顶层键，而不只是四个契约键：把键映射到 `AdvisorStepId` 阶段由分发器负责，这样增加键的提供方只会退化为更少的可见阶段，而不是运行失败。
