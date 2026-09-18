---
description: "面向 UI 命令平面的 /side（别名 /btw）斜杠命令：就最近一条排队消息向顾问提出旁路提问。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-side

[English](README.md) | 中文

## 摘要

`dsh-command-side` 为用户提供 `/side` 命令（`/btw` 为别名），从 UI 命令平面直接向已挂载的队列顾问（queue advisor）就最近一条排队消息发起一次旁路提问。该命令复刻队列智能按钮的 advise 动作：顾问运行通过顾问面板流式呈现，而队列与正在运行的回合不受影响。命令及其直接输出只留在 UI 中，不进入模型请求。未挂载 `queueAdvisor` 服务的部署会得到直接的错误提示，而不是静默无操作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

## 使用本包

在同时挂载了命令适配器与 `session-advisor-llm` 调度器的交互式部署中使用 `dsh-command-side`——已发布的 Web profile 即参考实现。缺少调度器时命令仍会注册，但每次调用都会报告缺少顾问。

### 命令参考

| 输入 | 结果 |
|---|---|
| `/side <question>` | 对最新一条待处理排队消息以键入的问题发起一次顾问运行；直接结果会指明目标消息 |
| `/btw <question>` | `/side` 的别名拼写，注册为独立命令定义并接到同一处理器 |
| `/side`（无输入） | 用法错误：旁路问题不能为空 |
| 队列为空时的 `/side <question>` | 用法错误：先在回合运行期间排队消息，再提问 |
| 未挂载顾问时的 `/side <question>` | 直接错误，指明部署缺口 |

## 理解实现

插件注册两个 `CommandDefinition`（`side`、`btw`）并共享一个处理器——命令注册表没有别名概念，因此别名就是第二次注册，两种拼写都会出现在命令发现 UI 中。处理器通过严格服务存储解析可选的 `queueAdvisor` 服务，选取最新一条待处理项（先取 `nextTurn` 末尾，否则 `nextStep` 末尾），原样拼接其文本块，并以即发即忘方式调用 `queueAdvisor.run`——与会话控制器的 `advise` 队列动作完全一致：运行的 `advisor/*` 事件通过顾问面板流式呈现，启动失败只记录警告。本包是队列顾问能力缝的第二个消费者，而不是新的 Remote 表面。

## 模型体验

- **Token：** 零。命令、参数与结果保存在 `command/run`/`command/done` 日志记录中，仅入日志、绝不进入模型请求；顾问运行本身消耗顾问路由的 token，与智能按钮路径完全相同。
- **KV 缓存：** 本包不引起增长。无系统提示段、无工具 schema。
- **模型可见影响：** 无。运行读取的排队消息保持原样，队列也像智能按钮 advise 一样保持该条目待处理。

## 已知限制与延期工作

- No invariant companion is published: 除注册表注册外，本命令不拥有跨服务关系，而真实组合的 Loader 测试已直接观察到这些注册。
- 命令落定之后的启动失败（顾问路由不可用）只会体现为主机警告日志加顾问面板缺席；命令结果已经报告成功。把启动失败折叠进 `command/done` 修正需要命令平面尚未提供的生命周期回放缝。
- 别名以两个命令定义拼写，因此两者都会出现在命令发现中；注册表级别的别名概念推迟到第二个命令需要时再做。
