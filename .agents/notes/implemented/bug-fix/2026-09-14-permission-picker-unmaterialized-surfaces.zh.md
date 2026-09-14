# Agent Note：未物化界面上的权限选择器

Status: implemented

[English](2026-09-14-permission-picker-unmaterialized-surfaces.md) | 中文

## Problem

Web GUI 的访问级别 chip 与 `/permission` 弹窗对可用性的判断不一致。chip 由会话的 `permissions` 投影渲染，composer 在包括新建会话在内的每个会话界面都会绘制它；而弹窗装饰要求 `sessions.binding(sessionId)?.session`——即已物化的会话门面。在新建会话屏幕（以及任何未物化界面）上，chip 可见可点，弹窗却毫无反应：`options` 抛出 `permission presets are not available on this host`，`onSelect` 抛出 `this session is not materialized yet`，`available` 返回 `false`，斜杠命令行直接落空。同一个控件、两个可用性来源——可见的一半欺骗了可点的一半。

## Decision

选择器有了第二个来源：宿主的 permission 设置命名空间——通用设置行读取和写入的同一描述符。只要投影 select 或该命名空间存在，`available` 即为 `true`。`options` 仍优先投影；没有已物化会话时，它等待设置镜像，经 `permissionDefaultOf` 读取命名空间动态的 `defaultPreset` enum，并以与投影行相同的本地化标签、active 标记和完全权限风险门呈现。`onSelect` 对已物化会话仍提交 `/permission <preset>`；在未物化会话上则通过控制器既有的设置变更把所选项写为新会话默认值——当前会话绝不被触碰。插件在 apply 时预热设置镜像（`controller.load()`），因为选择器在任何设置页访问之前就需要它；describe 失败的宿主让选择器退回仅投影路径，与变更前的表现完全一致。

相应地，ghost 会话测试的含义随之改变：在未提供该命名空间的宿主上，options 以与之前相同的宿主错误拒绝；没有默认值行时，未物化选择不提交任何内容。新增测试在提供了命名空间的宿主上驱动未物化会话，断言带标签的行、激活的默认值以及 `settings/mutate` 写入。

## Alternatives considered

**在未物化界面上隐藏 chip。** 隐藏 composer chip 会隐藏投影确实携带的状态，而新建会话屏幕恰恰是启动前设置默认值最有用的地方。这也会让设置行成为会话前唯一的控制入口，还多隔一个屏幕。

**让宿主 `/permission` 命令支持未物化会话。** 该命令写入会话的实时权限策略；不存在的会话无从写入。经由既有的默认值写入来满足意图，既保住了宿主命令的契约，也完全不需要改动宿主。

## Consequences

chip 不再是死胡同：每个渲染它的界面都能打开选择器，而一次选择总有明确的落点——有活动会话就写会话，没有就写新会话默认值。代价是第二条读取路径和每次客户端启动的镜像预热；无权限宿主的行为与之前完全一致。通用设置行与选择器现在共享同一个命名空间视图，两者的标签与选项集只可能一起漂移，不会各自为政。
