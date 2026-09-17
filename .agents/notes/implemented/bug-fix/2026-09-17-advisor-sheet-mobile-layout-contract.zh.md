# Agent Note: Advisor sheet mobile layout contract

Status: implemented

[English](2026-09-17-advisor-sheet-mobile-layout-contract.md) | 中文

- Kind: bug-fix
- Scope: packages/client/ui-conversation
- Date: 2026-09-17

## 问题

真机截图（430×932 手机上的 Smart-steer advisor 面板）显示文本层相互重叠。对已构建 bundle 的 Playwright 探测在 390×664 与 430 宽 touch 视口下均未复现——只有一个对话框、标题位于卡片顶部；而对同一表面的评审确认了四个真实移动缺陷，与产生截图的构建无关：Modal 标题位于滚动容器内部，滚动快照会把标题和唯一的关闭控件移出视野；页脚动作按钮与关闭按钮以 28 px 渲染，低于 HIG 的 44 px 下限；面板 以 `min(72vh, 560px)` 封顶，而 iOS 的动态面板使 `vh` 不稳定；裁决排在最后、低于流水线各行，尽管裁决正是打开 面板 的原因。

## 决策

`AdvisorSheet` 不改动共享的 `Modal` 原语，而是把它的 `contentClassName` 变成固定框架：框架为 `flex: 1; min-height: 0; overflow: hidden`，其最后一个结构子元素（Modal 的内部 body 包装层，没有 class 钩子）成为承载滚动区的 flex 列。标题、关闭按钮与页脚保持原位；只有快照滚动。子元素的根是唯一滚动容器。内容顺序为 gate → verdict → 快照行 → pipeline：先决策，然后产生决策的事实，逐阶段细分排在最后。pipeline 的细节文本指向"上方的快照"，由于行就位于 pipeline 正上方，这一表述保持为真。块分隔线（verdict 块与 rows 块的 `border-top`）标出三个阅读区；gate 打开 面板 时顶部无边框。

在粗指针设备上，面板 内的每个按钮提升到 `min-width`/`min-height: 44px`（`@media (pointer: coarse)`），覆盖 `Button size="sm"` 动作（28 px）与关闭按钮（28 px），且无需为桌面分支化原语的几何。面板 保留 `vh` 在 `dvh` 之前的声明，使不支持 `dvh` 的浏览器获得回退；框架契约假设 Modal 的 DOM（标题与 body 位于 `.content` 内），因此 Modal DOM 的变化会最先在此处显现——表现为 advisor 标题不再固定。

## 已考虑的替代方案

- 为 `Modal` 原语打补丁，增加 `headerClassName` 与固定标题模式 —— 否决：所有其他 Modal 消费者都会吸收一个它们并不使用的布局模式，且改动会为单一 面板 契约触及跨包原语。
- 只修复报告的重叠，等待可复现的构建 —— 否决：启发式评审已在结构上确认四个缺陷，与产生截图的构建无关。
- 用 UA 嗅探而非 `pointer: coarse` 分支几何 —— 否决：媒体查询追踪的正是 44 px 规则所针对的输入方式；UA 字符串会腐化。

## 后果

- Modal 原语未改动；所有其他 Modal 消费者保持其当前几何。
- 框架以结构方式（`:last-child`）定位于 body 包装层——这一关系由 CSS 注释为其唯一消费者记录；它不能作为通用 Modal 布局复用。
- 本地化文本、`role="dialog"` 命名与按钮标签未变，因此 replay-e2e 选择器与模型可见行为不受影响。
