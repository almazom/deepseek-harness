---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-17-released-v4-headless-origin

[English](2026-09-17-released-v4-headless-origin.md) | 中文

## 概述

将 released v4 Session header 的 origin 在 `subagent` 之外向 `headless` 取值开放，并把写入器升到版本 4。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-17-released-v4-headless-origin
baseline: false
changes:
  - root: "JsonlHeaderLine"
    previous: "2026-09-11-initial"
    after: "ccb0bfd91bb22e2254cf90d3e3ffc5b351e0bc7f1680cb9bea1cfa47fb30dbe3"
    decision: version-bump
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "617b4fe6312ab550656095d55478dc1f42497d54ba0c3b52968c78aed539dabe"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

这是 released 格式的边界变更，因此确认决策为 `version-bump`：v4 写入器写出的日志会被旧版本构建以不支持的格式拒绝，直到它们带上 v3-to-v4 边界；对 v3 日志的直接扫描仍由 `sessionFormatVersionRefusal` 以与前任版本相同的方式把关。可接纳的取值只有 `subagent` 与 `headless`；其余取值仍在 header 校验器处拒绝。已提交的 v3 代从不被原地改写——发布在旁侧创建带版本的 v4 后继，而无头机制之前创建的会话保持缺失的 origin，含义不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/session/session-format packages/session/session-format-v3-to-v4 packages/session/session-format-catalog packages/session/session-persistence-jsonl packages/core/session packages/test-support/llm-replay：2401 个测试通过；pnpm run typecheck 与 pnpm run lint 退出码 0。

<a id="dev-note"></a>
## 开发备注

无。
