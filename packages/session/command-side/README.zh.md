---
description: "面向 UI 命令平面的 /side（别名 /btw）斜杠命令：就最近一条排队消息、或在队列为空时就对话中最新一条消息，向顾问提出旁路提问。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-side

[English](README.md) | 中文

## 概述

`dsh-command-side` 为用户提供 `/side` 命令（`/btw` 为别名），向已挂载的队列顾问（queue advisor）就最近一条排队消息发起一次旁路提问。队列为空时，命令回退到对话中最新一条已送达的人类消息。排队路径复刻队列智能按钮的 advise 动作：顾问运行通过顾问面板流式呈现，而队列与正在运行的回合不受影响。命令及其直接输出只留在 UI 中，不进入模型请求。未挂载 `queueAdvisor` 服务的部署会得到直接的错误提示，而不是静默无操作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在同时挂载了命令适配器与 `session-advisor-llm` 调度器的交互式部署中使用 `dsh-command-side`——已发布的 Web profile 即参考实现。缺少调度器时命令仍会注册，但每次调用都会报告缺少顾问。

### 命令参考

| 输入 | 结果 |
|---|---|
| `/side <question>` | 对最新一条待处理排队消息以键入的问题发起一次顾问运行；直接结果会指明目标消息 |
| `/btw <question>` | `/side` 的别名拼写，注册为独立命令定义并接到同一处理器 |
| `/side`（无输入） | 用法错误：旁路问题不能为空 |
| 队列为空时的 `/side <question>` | 对对话中最新一条已送达的人类消息发起顾问运行；对话尚无人类消息时，给出先发消息的用法错误 |
| 未挂载顾问时的 `/side <question>` | 直接错误，指明部署缺口 |

<a id="understand-the-implementation"></a>
## 理解实现

插件注册两个 `CommandDefinition`（`side`、`btw`）并共享一个处理器——命令注册表没有别名概念，因此别名就是第二次注册，两种拼写都会出现在命令发现 UI 中。处理器通过严格服务存储解析可选的 `queueAdvisor` 服务，选取最新一条待处理项（先取 `nextTurn` 末尾，否则 `nextStep` 末尾），原样拼接其文本块，并以即发即忘方式调用 `queueAdvisor.run`——与会话控制器的 `advise` 队列动作完全一致：运行的 `advisor/*` 事件通过顾问面板流式呈现，启动失败只记录警告。队列为空时，处理器读取本包自有的 `command-side/latest-human` 会话投影单元——对 `user/message` 事件的主机侧折叠，保留最新的来源为直接人类输入且文本非空的消息——以该消息 id 锚定运行，回退读取的是维护中的投影状态，而不是扫描历史事件；注入的上下文与纯附件消息不会入选。本包是队列顾问能力缝的第二个消费者，而不是新的 Remote 表面。

<a id="model-experience"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

空队列回退锚点是本包自有的 `command-side/latest-human` 投影单元，在 `apply` 中注册；折叠语义变更必须递增 `stateVersion`。命令文案位于主机代码而非客户端语言字典；只有顾问面板字符串走字典。

</details>

## 模型体验

### 命令结果与建议运行

#### 模型看到什么

本包不向模型展示任何内容。命令、参数与结果保存在 `command/run`/`command/done` 日志记录中，仅入日志。建议运行读取的正是智能按钮 advise 路径同样的会话快照框架文本，任何顾问文本都不进入智能体历史。

#### Token 影响

本包为零：不新增系统提示段，也不新增工具 schema。建议运行消耗顾问路由的 token，与智能按钮路径完全一致。

#### KV Cache 影响

零增长：本包不贡献系统提示内容，智能体 KV 缓存不受影响。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- No invariant companion is published: 除注册表注册外，本命令不拥有跨服务关系，而真实组合的 Loader 测试已直接观察到这些注册。
- 命令落定之后的启动失败（顾问路由不可用）只会体现为主机警告日志加顾问面板缺席；命令结果已经报告成功。把启动失败折叠进 `command/done` 修正需要命令平面尚未提供的生命周期回放缝。
- 别名以两个命令定义拼写，因此两者都会出现在命令发现中；注册表级别的别名概念推迟到第二个命令需要时再做。
- 空队列运行启动之后、面板采纳之前若有一条消息入队，该次运行将没有可见面板；运行事件仍会落入日志，且排队行的智能按钮仍然可用。
- 处理器在命令时刻读取队列，因此仍处于客户端提交回显中的行（服务端拼接未完成）会让命令回退到最近送达的消息而不是锚定该行；运行仍会启动，且已提交的行保留其智能按钮。
