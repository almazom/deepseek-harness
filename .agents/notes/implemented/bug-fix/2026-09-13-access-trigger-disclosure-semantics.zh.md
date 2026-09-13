# Agent Note: 访问模式触发器公开菜单语义

Status: implemented

[English](2026-09-13-access-trigger-disclosure-semantics.md) | 中文

## 问题

作曲区的「访问模式」触发按钮会打开 `Menu`，但未渲染 `aria-expanded` 和 `aria-haspopup`。辅助技术只能把它播报成普通按钮：用户既听不出它会展开菜单，也听不出菜单当前是否展开。同一作曲条中的命令启动器触发按钮已经反映 `aria-expanded`，并有规格测试固定该契约——同一行里的两个展开式触发器因此不一致。对已发布的 0.1.5-rc.2 Web 构建的实测探针显示，菜单展开时 `expanded: null`。

## 决策

**作曲条中每个切换弹层的触发器都必须反映展开语义。** 访问模式触发器无条件设置 `aria-haspopup="menu"`（它唯一的弹层就是权限菜单），并把 `aria-expanded` 绑定到菜单的展开状态。这两个属性是固定标记而非产品文案，因此本地化所有权与 `verify-client-ui-i18n` 不受影响。权限应用流程（包括完全权限的 `RiskConfirmation` 步骤）保持不变。

## 验证

- `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` 新增 `the Access trigger exposes menu disclosure semantics`：关闭 → `false`，展开 → `true`，选择后 → `false`。
- `pnpm vitest run packages/client/ui-conversation/tests/input-bar.client.spec.tsx` 通过；`pnpm run build:lib:host` 之后 `pnpm run typecheck:contracts-ready` 通过。

## 备选方案

- **用拥有展开语义的基元包装触发器。** 本次改动拒绝：启动器触发器已直接携带这些属性，为一对属性引入新包装层是增加间接性而不删除自有代码。
- **由 `Menu` 内部自动设置 `aria-expanded`。** 拒绝：锚点元素属于特性侧；由基元改动调用方拥有的节点会模糊保持 `client-ui-primitives` 无 Cordis 且纯展示的所有权边界。
- **留待更广泛的审计。** 拒绝：该不对称已被现有启动器规格固定，补上这一契约只是每个属性一行的补全，而非发现型工程。

## 后果

- 辅助技术将访问模式触发器播报为菜单按钮并跟踪其展开状态，与同一作曲条中的命令启动器一致。
- 未来切换弹层的触发器应沿用这一配对（`aria-haspopup` 固定标记 + `aria-expanded` 绑定展开状态）；新规格测试即行为模板。
- 无运行时、线路或文案表面变化：关闭态的 aria-haspopup 与 aria-expanded="false" 在本仓库的 Playwright ariaSnapshot 金样中不产生状态标记（启动器触发器已带 aria-haspopup="listbox" 且在 hero 金样中为裸按钮），除已通过的格式门禁外，不影响任何快照、本地化或卫生门禁。
