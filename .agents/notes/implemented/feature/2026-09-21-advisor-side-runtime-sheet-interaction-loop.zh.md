# Agent Note: 顾问面板升级为完整的旁路会话交互循环

Status: implemented

[English](2026-09-21-advisor-side-runtime-sheet-interaction-loop.md) | 中文

- Kind: feature
- Scope: packages/api/session-controller, packages/api/remotes, packages/client/ui-conversation
- Date: 2026-09-21

## 问题

顾问面板此前只能打开一次：排队行的智能按钮流式执行一次旁路运行后就结束了——面板内无法追问，没有折叠态，也没有显式关闭。而 /btw 旁路会话模式要求：多轮追问、保持主会话可交互的 peek 态、随时可关闭。过程中还暴露了两个隐性陷阱：追问的 wire 字段在 fetch 前被静默剥离；以及当待回答的 ask_user_question 卡片隐藏队列 dock 时，折叠后的迷你条会随之消失。

## 决策

追问复用既有的 `advise` 队列动作：advise 成员新增可选 `question` 字段，因此第二次旁路运行只是一次额外的 `updateQueue` 调用——不需要新的 Remote 方法，host 透传（`session-controller`）原样把问题转给 dispatcher。客户端面板新增面板内输入框（内容为空或旁路运行进行中时发送按钮禁用）、把面板折叠为迷你条的 collapse 控件、恢复面板的 expand 控件，以及显式关闭（同时移除面板与迷你条、保持队列不动）。迷你条通过 `createPortal(document.body)` 渲染，采用 `position: fixed; z-index: 900`（低于 1000 的 Modal 遮罩）：portal 化正是问题面板隐藏 dock 列时 peek 仍可触达的原因——这符合 P2 黄金模式"peek 必须悬浮于任何页面卡片之上且可点击"的规则。面板设置显式 `height: min(72dvh, 560px)`，因为 Modal 对话框的自动高度曾把 flex-basis 为 0 的内容区压成只剩页脚。

## 已否决的替代方案

- 专门的 `adviseFollowUp` Remote 方法——否决：为一个可选字段复制 `updateQueue` 的按条目动作主干，正是 2026-09-18 笔记对 `advise` 本身否决过的做法。
- 迷你条留在 dock 列内、仅提高 z-index——否决：问题面板会把 dock 从布局中移除（`display: none`），任何层叠顺序都无法让迷你条复活；portal 是能在隐藏之下存活的最小改动。
- 在 Playwright 中对展开按钮做 force/retry 点击——否决：那是用测试手段掩盖产品缺陷；portal 落地后，普通的无障碍驱动点击是完全确定的。

## 影响

- "陈旧聚合包陷阱"自此成为必须遵守的教条：浏览器 RPC 参数由内联进聚合文件 `packages/api/remotes/lib/client.js` 的 zod codec 解析。该聚合由各包的 `./remote` 入口经 `pnpm --filter @deepseek-ai/dsh-api-remotes bundle` 构建，且当依赖包的 `lib/*.js` 变化时 tsdown 缓存不会重建它。修改 `src/types.ts` 中任何 wire 类型后，必须重建所属包的 bundle 和 remotes 聚合，否则旧 schema 会静默剥离新字段（聚合重建前，追问 POST 只携带 `{"kind":"advise"}` 而没有 `question`——不报错，只是丢失）。
- 迷你条脱离了组件自身的渲染容器，组件测试必须通过 `screen`（document.body）查询；限定在 RTL 容器内的 DOM 断言将看不到它。
- Web e2e `apps/web/tests/advisor-side-runtime.e2e.ts` 在 `DSH_SNAPSHOT=replay` 下走完整循环——排队、打开、流式结论、线上追问、peek、展开、关闭、回答检查点以清空 dock——全程零控制台错误，并在 `DSH_GOAL_EVIDENCE=1` 时把各状态截图落到 `.goal-evidence/`。
- 新的 web e2e 规格按设计要登记两处：在 `apps/web/tsconfig.json` 的客户端程序中排除，并列入根 `tsconfig.host.json`（它们会启动 host 主干）。漏掉 host 清单会让文件落在所有项目之外，type-aware lint 会以 error-typed imports 的形式报出。
