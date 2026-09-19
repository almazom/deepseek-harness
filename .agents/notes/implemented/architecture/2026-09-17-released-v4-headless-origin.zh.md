# Agent Note：released v4 向 Session header origin 开放 headless 取值

Status: implemented

[English](2026-09-17-released-v4-headless-origin.md) | 中文

## 问题

自 released v2 格式起，Session header 可以记录 `origin: "subagent"`，而所有需要对 subagent 会话特殊处理的消费方都判断该取值。一次性无头 runner 创建的是普通 Session，因此脚本化运行与操作者手动打开的 Session 在任何已存储的 header 中都无从区分，任何消费方永远无法分辨它们。

## 决策

`SESSION_FORMAT_VERSION` 按照标准相邻迁移机制（见 [released 迁移](2026-08-31-released-session-format-migrations.zh.md)）升到 4。版本 4 只改动一条准入规则：持久化 header 的 `origin` 字段在 `"subagent"` 之外接受 `"headless"`。事件类型、payload 成员和其他 header 字段都不变，因此 [v3-to-v4 转换](../../../../packages/session/session-format-v3-to-v4/README.zh.md)是一次恒等转换：仅重定 header 版本并按放宽后的 origin 重新校验；它借用冻结的 released-v3 codec 行作为占位，而不复制帧协议代码。

放宽后的规则在每个关注点上只存在一处。released 边界校验 v4 header。当前 Session 运行时在从创建 meta 附加 `origin` 时接受两个取值，对其余取值仍然拒绝。subagent 专属语义——后代索引、subagent 所有权栅栏、以及 runner 对带 `subagent` 父会话的采用拒绝——继续只判断 `subagent`，从不依据 `headless` 分支；无父会话的 `headless` origin 依然可被采用。

## 已考虑的替代方案

**保留单一 origin，把运行类别写进事件。** header origin 是既有的、机器可读的创建字段；平行的事件会重复它，并让所有既有的无头感知消费方继续读取更窄的字段。

**接受任意字符串 origin。** 开放取值会让每个消费方的相等判断悄悄漏掉新值。封闭的双值联合让漏判在格式边界上保持响亮。

## 后果

v4 writer 写出的日志会被旧版本构建以不支持的格式拒绝，直到它们带上这条边界；这是[版本机制](2026-08-10-session-log-version-mechanism.zh.md)记录的标准发布成本。在本变更之前创建的 Session 保持缺失的 origin，并永远与人工会话无从区分——这次放宽不是回填。[session-format-status](../../../../docs/session-format-status.zh.md) 中的 release 记录仍标注 v3，直到某个产品发布真正发布 v4。
