# Agent Note: /side（/btw）命令——queueAdvisor 的第二个消费者

Status: implemented

[English](2026-09-21-command-side-btw-alias-second-queueadvisor-consumer.md) | 中文

- Kind: feature
- Scope: packages/session/command-side, packages/preset/agent-presets, packages/bundle
- Date: 2026-09-21

## 问题

此前只有队列停靠栏的智能按钮能发起顾问旁路运行：回合进行中的操作者想就最新排队消息追问一句"顺便问下 X"，必须先找到那一行再去点。命令平面——这个无需触碰队列即可使用的 UI 表面——没有同一动作的拼写。

## 决策

新包 `packages/session/command-side` 注册两个共享同一处理器的 `CommandDefinition`（`side` 与 `btw`），因为命令契约没有别名概念（`CommandDescriptor` 只有 `name`）。处理器通过严格服务存储解析可选的 `queueAdvisor` 服务，选取最新一条待处理项（先取 `nextTurn` 末尾，否则 `nextStep` 末尾），原样拼接其文本块，并以即发即忘方式携带键入的问题调用 `queueAdvisor.run`——这是会话控制器 `advise` 队列动作的逐字镜像，使该命令成为队列顾问能力缝的第二个消费者，而不是新的 Remote 表面。启动失败只记录警告，已返回的命令成功结果保持不变，与智能按钮路径的接受语义一致。

## 已考虑的替代方案

- 扩展命令注册表增加 `aliases` 字段——v1 拒绝：它会触及共享的 `CommandDescriptor`、命令发现 UI 与加载器契约，却只服务一条命令；两次注册是最小且诚实的拼写，两种拼写都出现在发现中并标注别名。
- 处理器调用 `SessionCommandController.updateQueue`——拒绝：该控制器是 `SessionController` 的私有成员，不是可注入服务；直接的 `ctx.get('queueAdvisor')` 消费者才是受认可的能力缝。
- 像 `steer` 动作一样要求 `agent.status === 'running'`——拒绝：advise 对任何待处理排队消息都有效，队列停靠栏按钮同样不按状态设门。

## 后果

- 两种拼写都出现在命令发现 UI 中；注册表级别的别名概念继续推迟，直到第二个命令需要它。
- 命令落定后的启动失败只体现为主机警告加顾问面板缺席——命令结果已报告成功；把迟到的失败折叠进 `command/done` 需要命令平面尚未提供的生命周期回放缝。
- 本包走标准组合行（standard/ptc/cordis 预设、base bundle 补丁与依赖、web-app 浏览器平面 `disabled: true`），无头与浏览器包保持不变。
- `session-advisor-llm` 的 README 现在记录了其 invariant 伴随包的省略原因（本变更验证 README 时双语配对门暴露了该缺口）。
