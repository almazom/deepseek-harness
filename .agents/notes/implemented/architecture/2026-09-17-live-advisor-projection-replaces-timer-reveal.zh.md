# Agent Note: 实时建议投影取代计时器式的顾问面板

Status: implemented

[English](2026-09-17-live-advisor-projection-replaces-timer-reveal.md) | 中文

- Kind: architecture
- Scope: packages/client/ui-conversation, packages/session/session-advisor-llm
- Date: 2026-09-17

## 问题

Smart-steer 顾问面板用 `useStepReveal` 安排推理行的出现节奏——一个 150 毫秒的计时器，不依赖任何外部事实逐行展示推理：这是虚假的逐步揭示。/btw 风格的实时侧问运行需要相反的行为：阶段因模型真正产出了它们而出现、由宿主流式推送，面板绝不能自己发明节奏。

## 决策

`session-advisor-llm` 向 `SessionProjectionMap` 合并一个键：`advisor/run` → `AdvisorRunProjection`（整体运行值：`status`、带逐字模型发现的已完成 `steps`、以及结算后的 `verdict`）。宿主是唯一计算点，随每个阶段闭合与结算整体重发布该值；客户端不做折叠。`QueueDock` 通过标准 `useProjection` 座位读取该键，并以 `queuedItemId` 与被建议行匹配；属于其他行的运行（或键缺失）回退到 tier-1 瞬时预判。`AdvisorSurface` (smart_steer client half; formerly ui-conversation `AdvisorSurface`) 用原始发现文本渲染实时阶段行——模型输出是数据而非本地化文案——并用投影置信度对照配置的 `smartSteerMinConfidence` 计算实时门槛行。失败的运行保留其部分发现、标记失败，并回退到作为现行指引的 tier-1 门槛与判定行。`useStepReveal`、`STEP_REVEAL_MS` 与 `stepStatus` 一并删除：tier-1 行是同步计算的，立即以 `done` 渲染；实时行则随投影落地而出现。

## 已考虑的替代方案

- 在实时路径之下保留计时器揭示作为回退 —— 否决：目标明确禁止计时器伪造的步骤，且同一表面保留两套节奏系统会让测试矩阵翻倍而不带来任何行为。
- 把逐步事件投影到客户端、由浏览器折叠出运行状态 —— 被 session-projection 架构否决：宿主是唯一计算点，客户端域折叠会复制分发器的状态机。
- 按队列条目键控投影（`advisor/run/<itemId>`）—— 否决：顾问一次只运行一个侧问，面板也只显示一行；带 `queuedItemId` 匹配的单键保持键空间有界，并契合 queue mirror 的整值风格。

## 后果

- 面板的判定与门槛行现在有三种来源——tier-1 结果、实时进行中、实时判定、实时失败回退——每一支都由 queue-dock 组件测试覆盖；新增实时分支必须同时更新它们，否则回退测试会失败。
- 宿主分发器已随[队列动作分发器笔记](2026-09-18-advisor-side-run-dispatcher-rides-queue-action.zh.md)落地；在某个 profile 挂载它之前，生产环境中 `advisor/run` 读作 `null`，面板行为与原 tier-1 面板完全一致。
- 删除揭示计时器让 tier-1 面板在视觉上即时呈现；等待推理行的 replay e2e 断言改为在首次绘制即达最终状态，而不再等待 600 毫秒。
