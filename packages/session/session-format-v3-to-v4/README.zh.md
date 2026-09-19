---
description: "已发布的 v3 Session codec，包含到 v4 的恒等转换与放宽的 header origin。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

[English](README.md) | 中文

## 概述

本包将已发布的 v3 Session JSONL 还原为 v4，并以完全一致的已发布 v3 行语义写入 v4。转换是恒等的：每个事件、序号位置、surface 操作与来源引用原样通过，只有 header 版本从 3 变为 4。版本 4 将 header 的 `origin` 字段在已发布 v3 的 `"subagent"` 取值之外开放给无头（headless）取值；其他 header 字段、事件类型与负载成员均不变。格式错误的行、未知的 origin 与不支持的关系会在当前还原器运行之前被拒绝，并保留来源以供恢复。

## 目录

- [使用本包](#use-this-package)
- [V3 到 V4 规范](#v3-to-v4-specification)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时使用

持久化通过 `dsh-session-format-catalog` 获得此边界；功能组合不挂载它。只有在组装或测试静态已发布格式目录时才直接导入。本包不发布运行时不变量伴生组件，因为它没有独立可观察、状态可能分叉的运行时注册；解码器与迁移阶段的状态只属于单次还原。

### 入口

```text
const decoder = releasedV4SessionFormatCodec.createDecoder(physicalHeader, 'recoverable')
for (const row of physicalRows) decoder.decodeRow(row, migrationContext)
const inheritedEventCount = decoder.finish(migrationContext)
const stage = sessionFormatV3ToV4.createStage(stageInput)
stage.transformEvent(event, migrationContext)
const targetInheritedEventCount = stage.finish(migrationContext)
```

`releasedV4SessionFormatCodec` 读取精确的 v4 header——即放宽了 `origin` 的 v3 header——并把行框架委托给冻结的已发布 v3 codec。`sessionFormatV3ToV4` 为每次还原创建一个有状态阶段；静态目录连接该解码器与阶段，使迁移不保留物理行数组。`assertReleasedV4Header` 与 `restoreReleasedV4Artifact` 提供目录使用的目标准入。

-----

<a id="v3-to-v4-specification"></a>
## V3 到 V4 规范

- **Header** —— `migrateHeader()` 接受精确的已发布 v3 header，返回相同字段并把 `version` 置为 4。`origin` 字段携带其 v3 取值原样通过；v4 写入器可以把 `origin` 设为 `"headless"`，目标验证器同等地接受 `"subagent"`、`"headless"` 与缺省。
- **事件** —— 阶段原样重发每个事件的原始序号、时间、数据、surface 操作与来源引用。稠密的 v3 序列保持为稠密序列，因此无需重映射任何本地引用。
- **继承** —— 最后一个携带 `data.inherited: true` 的 `session/end-seed` 标记标识继承切点，并保持其来源序号位置。未继承的来源不得包含该标记，且必须产出零切点。
- **投递标记** —— 声称格式 v4 的 `session-log-deepseek/delivery-accepted` 标记会被拒绝；命名不同 Session 且位于当前生成中的 v3 标记会被拒绝，与已发布 v3 边界的强制规则完全一致。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

codec 负责 v4 物理 header 准入，并为其他所有字段与行语义借用冻结的已发布 v3 验证器；已发布验证器不会漂移，因此借用的行为是确定性的。迁移阶段跟踪密度、继承切点与外部投递标记，并原样发出每个来源事件。

| 文件 | 职责 |
|---|---|
| [`src/codec.ts`](src/codec.ts) | 冻结的 v4 物理 header 与行委托 |
| [`src/migration.ts`](src/migration.ts) | 恒等边界与切点簿记 |
| [`src/validation.ts`](src/validation.ts) | 精确目标验证与工件还原 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [迁移机制](../session-format/README.zh.md)——纯链条与 codec 契约。
- [静态目录](../session-format-catalog/README.zh.md)——构建期组装。
- [Session 子系统](../../../docs/subsystems/session.zh.md)——当前逻辑 Session 语义。

-----

<a id="model-experience"></a>
## 模型体验

### 历史还原

#### 模型看到什么

什么都看不到。还原之后，`deriveMessages()` 看到在 v4 下保持不变的规范已发布 v3 事件。

#### Token 影响

无直接影响。

#### KV Cache 影响

无直接影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **封闭的 v3 来源准入**——v3 来源保持已发布 v3 的 `origin` 词表；无头取值仅在 v4 中可写。
- **单一相邻边界**——本包不执行发布，也不选择后续迁移。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
