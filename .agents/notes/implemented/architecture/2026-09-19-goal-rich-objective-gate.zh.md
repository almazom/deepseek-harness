# Agent Note：goal 域新增可按部署配置的富 objective 准入门

Status: implemented

[English](2026-09-19-goal-rich-objective-gate.md) | 中文

## 问题

车队 goal-flow 管线要求每个循环目标都带有可验证的验收标准和可见的 Round 预算，但 goal 域此前接受任何非空 objective。每个创建入口——面向模型的 `create_goal` 工具路径、`edit`、`/goal` 命令以及 Typert 远程——都可能把一行式目标提交到目标面板。

## 决策

把准入门强制在 goal 域内部——所有创建消费者共享的唯一咽喉点。新增经验证的配置：`requireRichObjective`（默认 `false`）与 `minObjectiveChars`（默认 `80`）。门开启时，`create` 与 `edit` 会拒绝低于长度下限、缺少可验证验收子句、或在请求未指定 Round 上限时缺少可见预算子句的 objective。拒绝携带稳定的 `GOAL_OBJECTIVE_TOO_WEAK` 代码，并在 SGT-1 形状的改写提示中指出缺失部分；请求级 `maxGoalRounds` 满足预算子句。消费者保持轻薄，远程路径无法绕过该下限。

### 备注

- 门默认关闭：既有车队与测试接受短 objective；运行管线的部署通过组合配置启用。
- 面向模型的工具描述与系统提示指引保持不动（这些文本在 recorded-session 快照中逐字固定）；指令性拒绝在运行时教学该形状，预创建质量层（enrichment waves）由 `goal-expert`/`goal-flow` 技能在这层机械下限之上负责。

## Alternatives considered

- **在各消费者入口分别检查——工具 schema、`/goal` 命令与远程提示** — 任何直接调用方都能绕过；准入规则必须绑定创建 goal 的那个操作，而 goal 域是所有创建消费者共享的唯一代码路径（[在决策所在操作强制的规则](../../../../packages/AGENTS.md)）。
- **只依赖技能层的提示指引** — 会让 goal 域保持宽松，一行式目标仍会从任何消费者进入面板；enrichment 是这层下限之上的层级，不能取而代之。
- **由模型评审打分准入** — 每次创建都要一次请求、一个 API key 和非确定性；机械子句下限无需密钥且可单元测试，判断留在技能层。

## Consequences

- 换来：任何创建消费者——包括 Typert 远程——都无法提交低于下限的 objective，且 `GOAL_OBJECTIVE_TOO_WEAK` 提示在拒绝时刻教授 SGT-1 形状，而不是依赖被快照逐字固定的提示文本。
- 代价：子句下限基于关键词——测试把否定式（"unverified"）、屈折式（"judgement"）与前缀式（"re-verified"）的堆砌钉为拒绝，但携带关键词的新式弱表述仍能通过，真正的质量闸口仍是技能层。
- 代价：两个额外的受验证配置字段，以及一个可被快照固定的模型可见提示字符串。
