# Agent Note: Smart Steer 流水线推理行（SGT-1 第 2 轮）

Status: implemented

[English](2026-09-17-smart-steer-pipeline-reasoning-lines.md) | 中文

- Kind: architecture
- Scope: packages/client/ui-conversation
- Date: 2026-09-17

## 问题

第 1 轮的 Smart Steer 顾问面板（2b409fa, 151295b）只以状态标签（`Done`）展示流水线阶段，操作者无法看到 steer 为何被允许或扣留。操作者要求 Claude/Codex 式的可见推理：每个阶段必须给出结论，裁决必须对照置信度门槛给出理由。

## 决策

结论是本地化拥有的数据，而不是字符串。`runAdvisorPipeline(input, minConfidence)` 每个完成的阶段产出一个 `AdvisorStepDetail` —— 类型化的本地化键加 `Record<string, number>` 参数对象（统一的 `{key, params}` 形态；无参数的结论携带 `params: {}`）。`AdvisorSurface`（smart_steer 客户端半边；原为 ui-conversation 的 `AdvisorSheet`） 在每个阶段标签下渲染 `t(detail.key, detail.params)` 作为次级行，zh/en 文案留在词典中，模型不承担渲染职责。裁决阶段把 tier-1 置信度与从 `QueueDock` 传下的 `smartSteerMinConfidence` Config 字段比较；门槛只存在于经过校验的 `submission-settings` 模式（`DEFAULT_SMART_STEER_MIN_CONFIDENCE = 0.95`，`z.number().min(0.5).max(1)`），调用点不出现魔法数字。

## 已考虑的替代方案

- 保留仅状态标签，把推理藏进按需显示的 tooltip —— 否决：操作者要求内联阅读理由，而悬停交互在面板面向的移动端契约上不可用。
- 由 `runAdvisorPipeline` 产出自由字符串 —— 否决：客户端文案为本地化拥有（`verify-client-ui-i18n`），硬编码英文会破坏 zh 表面并把文案散落在词典之外。
- 打开面板时经模型调用计算结论 —— tier-1 否决：顾问路径是确定性的，不得引入延迟或不确定性；模型驱动的实时侧问运行是本包内独立的 smart_steer 分发器策略。

## 后果

- 增加一个阶段意味着增加一对本地化键和一个 detail 分支；面板无需改动。
- detail 联合是封闭的（8 个键，以穷尽的本地化映射收尾）；缺失 zh/en 键会在构建时使本地化键测试失败。
- tier-1 结论是对 `advise()` 同一套规则的确定性复述；它们不添加新的门槛逻辑，因此面板不会与顾问采取的动作相矛盾。
- 向 web e2e 脚手架添加了仅类型的增强导入（`@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-settings`），并补全了 `apps/web/tsconfig.json` 的引用以覆盖脚手架的真实依赖图 —— 发布同步合并（c291e79）把这些缺口藏在过期的增量构建之后，任何新的 apps/web 测试文件都会暴露它们。
