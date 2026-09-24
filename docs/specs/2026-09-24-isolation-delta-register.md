# Isolation Delta Register — 2026-09-24

Per-file register of every local core delta so cards TC-008..TC-013 execute a
closed worklist instead of re-deriving scope (plan Step 2, card TC-007).

- **Method:** content-based tree diff (shallow clone has no usable merge-base):
  `git diff --name-status c291e7961a..HEAD -- packages apps` + working tree
  (`git status --porcelain`), captured to `/tmp/p2i-delta-raw.txt`.
- **Upstream baseline:** tag `fb2c4b9e` (0.1.5-rc.2). Upgrade/repoint out of scope.
- **Taxonomy:** `PORT-TO-PLUGIN` (fleet plugin `client.js` first, cordis host
  stub second) / `DOCUMENTED-FORK` (type-level or seam-less, smart_steer
  pattern, declared in the fork docs) / `DROP` (obsolete or temporary).
- **Targets that name planned homes** (`ops/scripts/tailnet-auth-proxy.mjs`)
  are planned fleet asset-layer homes — that path does not exist in this
  checkout yet; TC-008..TC-013 create it.
- **Scope notes:** aux shell UI (layout/sidebar/theme/primitives/goal/
  permission-presets/trajectory) extends TC-008; serving layer
  (frontend-static, browser-auth) and apps/web boot injection are TC-013;
  goal gate + title-llm + projection-type churn fall under TC-011. The `card`
  column is authoritative for ownership.

## Register

| path | delta nature | target | card |
|---|---|---|---|
| `packages/client/ui-chat/src/client/chat/ChatView.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/chat/ContextInjectionRow.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/chat/HooksCard.tsx` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/chat/MessageItem.tsx` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/chat/ReasoningRow.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/chat/StatsPills.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/chat/TurnProcessNodeView.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/chat/TurnTailNodeView.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/chat/register-node-renderers.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/conversation-nodes/hooks.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/conversation-nodes/register.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/conversation-nodes/turn-max-tokens.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/src/client/locale.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-chat/tests/hooks-card.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-chat/tests/reasoning-rule.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-chat/tests/turn-tail-spacing.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-goal/src/client/GoalBar.module.css` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-goal/src/client/GoalBar.tsx` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-goal/tests/goal-pill.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-layout/src/client/AppFrame.module.css` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-layout/src/client/columns.ts` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-layout/src/client/index.ts` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-layout/src/client/service.ts` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-layout/src/client/stores.ts` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-layout/tests/app-frame.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-layout/tests/apply.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-layout/tests/layout-store.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-layout/tests/page-path-bridge.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-layout/tests/service.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-permission-presets/src/client/index.ts` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-permission-presets/tests/browser-plugin.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-primitives/src/Menu.tsx` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-primitives/src/icons/index.tsx` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-primitives/tests/icons.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-sidebar/src/client/SidebarRoot.tsx` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-sidebar/src/client/contract/slots.ts` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-sidebar/tests/apply.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-sidebar/tests/panel-list.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-sidebar/tests/pointer-scrollbars.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-sidebar/tests/sidebar-snapshot.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-theme/src/client/FontSizeRow.module.css` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-theme/src/client/FontSizeRow.tsx` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-theme/src/client/locales.ts` | aux shell UI DOM/CSS/behavior (scope extension per register) | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-theme/tests/font-size-row.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-trajectory/tests/views.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-workspace/src/client/contract/slots.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/index.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/locales.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/navigation.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/rows/Rows.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/rows/Rows.tsx` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/rows/SessionBrowserCore.tsx` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/rows/SessionsPage.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/rows/SessionsPage.tsx` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/stores.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/src/client/tree.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-008 |
| `packages/client/ui-workspace/tests/apply.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-workspace/tests/browser-styles.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-workspace/tests/host-home-staleness.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-workspace/tests/pinned-session-grouping.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-workspace/tests/rename-assembly.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-workspace/tests/sessions-page.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-workspace/tests/tree.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-workspace/tests/workspaces-service.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-008 |
| `packages/client/ui-conversation/README.i18n.yaml` | docs (feature contract + smartSteer flag) | PORT-TO-PLUGIN — plugin docs (moves with feature) | TC-009 |
| `packages/client/ui-conversation/README.md` | docs (feature contract + smartSteer flag) | PORT-TO-PLUGIN — plugin docs (moves with feature) | TC-009 |
| `packages/client/ui-conversation/README.zh.md` | docs (feature contract + smartSteer flag) | PORT-TO-PLUGIN — plugin docs (moves with feature) | TC-009 |
| `packages/client/ui-conversation/package.json` | build/package config | PORT-TO-PLUGIN — plugin package config | TC-009 |
| `packages/client/ui-conversation/src/client/apply.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/client/contract/records.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/client/contract/slots.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/client/input/submission-policy.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/client/locales.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/client/queue/QueueDock.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/client/queue/QueueDock.tsx` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/client/queue/preview.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/index.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/src/submission-settings.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-conversation/tests/apply-inject.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/client/ui-conversation/tests/apply-wiring.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/client/ui-conversation/tests/assembly-surfaces.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/client/ui-conversation/tests/host.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/client/ui-conversation/tests/preview.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/client/ui-conversation/tests/queue-dock.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/client/ui-conversation/tests/session-header-rename.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/client/ui-conversation/tests/submission-policy.client.spec.ts` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/client/ui-conversation/tsconfig.json` | build/package config | PORT-TO-PLUGIN — plugin package config | TC-009 |
| `packages/client/ui-user-questions/src/client/QuestionComposer.module.css` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-user-questions/src/client/QuestionComposer.tsx` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-user-questions/src/client/locales.ts` | UI DOM/CSS/behavior injection | PORT-TO-PLUGIN — fleet plugin client.js | TC-009 |
| `packages/client/ui-user-questions/tests/user-questions-composer.client.spec.tsx` | test (client unit suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-009 |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | type-level (generated api catalog: AskUser* decls + TurnEndReasonMap rep-loop entry) | DOCUMENTED-FORK — regenerate after TC-010/TC-011 type ports (rep-loop entry owned by TC-011) | TC-010 |
| `packages/interaction/tool-ask-user/README.i18n.yaml` | docs (recommended/autoDecide/timed_out contract) | PORT-TO-PLUGIN — plugin docs (moves with feature) | TC-010 |
| `packages/interaction/tool-ask-user/README.md` | docs (recommended/autoDecide/timed_out contract) | PORT-TO-PLUGIN — plugin docs (moves with feature) | TC-010 |
| `packages/interaction/tool-ask-user/README.zh.md` | docs (recommended/autoDecide/timed_out contract) | PORT-TO-PLUGIN — plugin docs (moves with feature) | TC-010 |
| `packages/interaction/tool-ask-user/src/index.ts` | tool contract behavior (recommended/autoDecide/timed_out) | PORT-TO-PLUGIN — fleet ask-user plugin | TC-010 |
| `packages/interaction/tool-ask-user/tests/tool-ask-user.spec.ts` | test (tool contract suite) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-010 |
| `packages/interaction/user-questions/src/types.ts` | type-level (question/answer wire types) | PORT-TO-PLUGIN — fleet ask-user plugin | TC-010 |
| `packages/acp/acp/tests/turns.spec.ts` | test (shape/robustness refresh accompanying local deltas) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/api/session-controller/src/list.ts` | type-level (SessionProjectionValue rename / projection listing) | DOCUMENTED-FORK — type-level, no plugin seam | TC-011 |
| `packages/api/session-controller/src/types.ts` | type-level (SessionProjectionValue rename / projection listing) | DOCUMENTED-FORK — type-level, no plugin seam | TC-011 |
| `packages/api/session-controller/tests/session-projections.host.spec.ts` | test (projection shapes under forked types) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/api/session-controller/tsconfig.host.json` | build config (host tsconfig) | DOCUMENTED-FORK — host build config | TC-011 |
| `packages/core/agent-loop/src/agent.ts` | loop logic (rep-loop detection hook in agent turn cycle) | PORT-TO-PLUGIN — cordis host stub (loop seam) | TC-011 |
| `packages/core/agent-loop/src/rep-loop.ts` | loop logic (repetition-guard driver, new file) | PORT-TO-PLUGIN — fleet loop plugin | TC-011 |
| `packages/core/agent-loop/tests/loop.spec.ts` | test (turn-cycle incl. rep-loop) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-011 |
| `packages/core/agent-loop/tests/rep-loop.spec.ts` | test (turn-cycle incl. rep-loop) | PORT-TO-PLUGIN — plugin test suite (moves with feature) | TC-011 |
| `packages/core/session/src/known-event-types.ts` | type-level (TurnEndReasonMap rep-loop-detected / known event types) | DOCUMENTED-FORK — type-level, no plugin seam (declare in DOCUMENTED-FORK package) | TC-011 |
| `packages/core/session/src/types.ts` | type-level (TurnEndReasonMap rep-loop-detected / known event types) | DOCUMENTED-FORK — type-level, no plugin seam (declare in DOCUMENTED-FORK package) | TC-011 |
| `packages/experimental/agent-team/tests/team.spec.ts` | test (FileHandle-GC robustness fix from baseline triage) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts` | test (gate / round-driver assertions under local deltas) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/goal/goal/README.i18n.yaml` | docs (rich-objective gate contract + config) | DOCUMENTED-FORK — docs with fork | TC-011 |
| `packages/goal/goal/README.md` | docs (rich-objective gate contract + config) | DOCUMENTED-FORK — docs with fork | TC-011 |
| `packages/goal/goal/README.zh.md` | docs (rich-objective gate contract + config) | DOCUMENTED-FORK — docs with fork | TC-011 |
| `packages/goal/goal/src/domain.ts` | runtime gate (rich-objective admission: GOAL_OBJECTIVE_TOO_WEAK) | DOCUMENTED-FORK — off-by-default product gate, no seam (fleet goal-flow directive) | TC-011 |
| `packages/goal/goal/src/index.ts` | runtime gate (rich-objective admission: GOAL_OBJECTIVE_TOO_WEAK) | DOCUMENTED-FORK — off-by-default product gate, no seam (fleet goal-flow directive) | TC-011 |
| `packages/goal/goal/tests/goal.spec.ts` | test (gate / round-driver assertions under local deltas) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/session/session-title-llm/src/index.ts` | loop logic (byte-budgeted title message selection) | DOCUMENTED-FORK — enhancement, no seam (declare) | TC-011 |
| `packages/session/session-title-llm/tests/llm.spec.ts` | test (byte-budgeted selection) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/shell/bash-local/tests/executor.spec.ts` | test (shape/robustness refresh accompanying local deltas) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts` | test (shape/robustness refresh accompanying local deltas) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/subagent/subagent-spawn-in-process/tests/subagent-spawn-in-process.spec.ts` | test (shape/robustness refresh accompanying local deltas) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/subagent/subagent/tests/continuation.spec.ts` | test (shape/robustness refresh accompanying local deltas) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `packages/typert/generator/src/analyzer.ts` | tooling (catalog generator for forked declarations) | DOCUMENTED-FORK — generator alignment | TC-011 |
| `packages/util/native-command/tests/native-command.spec.ts` | test (shape/robustness refresh accompanying local deltas) | DOCUMENTED-FORK — in-tree suite | TC-011 |
| `apps/cli/composition.md` | docs (plugins group map / advisory-runs family / composition graph) | DOCUMENTED-FORK — docs describe in-tree fork; port with fleet docs at repoint | TC-012 |
| `packages/README.i18n.yaml` | docs (plugins group map / advisory-runs family / composition graph) | DOCUMENTED-FORK — docs describe in-tree fork; port with fleet docs at repoint | TC-012 |
| `packages/README.md` | docs (plugins group map / advisory-runs family / composition graph) | DOCUMENTED-FORK — docs describe in-tree fork; port with fleet docs at repoint | TC-012 |
| `packages/README.zh.md` | docs (plugins group map / advisory-runs family / composition graph) | DOCUMENTED-FORK — docs describe in-tree fork; port with fleet docs at repoint | TC-012 |
| `packages/api/session-controller/package.json` | manifest (smart-steer workspace dep) | PORT-TO-PLUGIN — fleet composition manifest | TC-012 |
| `packages/api/session-controller/src/commands.ts` | loop logic (advise dispatch via optional ctx.queueAdvisor + type-only smart-steer import) | PORT-TO-PLUGIN — cordis command registry (host stub) | TC-012 |
| `packages/api/session-controller/tests/commands-queue-attachment.host.spec.ts` | test (queue attach incl. advise action) | PORT-TO-PLUGIN — plugin test suite | TC-012 |
| `packages/bundle/base/cordis.patch.yml` | cordis host registration (smart-steer plugin rows) | PORT-TO-PLUGIN — fleet cordis.patch.yml / preset inject (cordis host stub) | TC-012 |
| `packages/bundle/base/package.json` | manifest (smart-steer workspace dep) | PORT-TO-PLUGIN — fleet composition manifest | TC-012 |
| `packages/bundle/web-app/cordis.patch.yml` | cordis host registration (smart-steer plugin rows) | PORT-TO-PLUGIN — fleet cordis.patch.yml / preset inject (cordis host stub) | TC-012 |
| `packages/bundle/web-app/package.json` | manifest (smart-steer workspace dep) | PORT-TO-PLUGIN — fleet composition manifest | TC-012 |
| `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | cordis-visible hook point (conversation.input.dock.advisor slot entry) | PORT-TO-PLUGIN — fleet cordis host stub insert | TC-012 |
| `packages/plugins/README.i18n.yaml` | docs (plugin contract / group map) | DOCUMENTED-FORK — plugin docs | TC-012 |
| `packages/plugins/README.md` | docs (plugin contract / group map) | DOCUMENTED-FORK — plugin docs | TC-012 |
| `packages/plugins/README.zh.md` | docs (plugin contract / group map) | DOCUMENTED-FORK — plugin docs | TC-012 |
| `packages/plugins/smart_steer/README.i18n.yaml` | docs (plugin contract / group map) | DOCUMENTED-FORK — plugin docs | TC-012 |
| `packages/plugins/smart_steer/README.md` | docs (plugin contract / group map) | DOCUMENTED-FORK — plugin docs | TC-012 |
| `packages/plugins/smart_steer/README.zh.md` | docs (plugin contract / group map) | DOCUMENTED-FORK — plugin docs | TC-012 |
| `packages/plugins/smart_steer/package.json` | build/package config | DOCUMENTED-FORK — plugin build config | TC-012 |
| `packages/plugins/smart_steer/src/advisor-projection.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/client/AdvisorSurface.module.css` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/client/AdvisorSurface.tsx` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/client/advisor.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/client/index.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/client/locales.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/client/owner.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/config.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/css-modules.d.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/dispatcher.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/index.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/latest-human.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/side-command.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/src/types.ts` | plugin product surface (dispatcher/advisor/side-command/projections) | DOCUMENTED-FORK — smart_steer pattern, in-tree documented fork (TC-012 confirms fleet move vs fork) | TC-012 |
| `packages/plugins/smart_steer/tests/advisor-projection.spec.ts` | test (smart_steer plugin suite) | DOCUMENTED-FORK — in-tree plugin suite (moves if TC-012 elects fleet move) | TC-012 |
| `packages/plugins/smart_steer/tests/advisor-surface.client.spec.tsx` | test (smart_steer plugin suite) | DOCUMENTED-FORK — in-tree plugin suite (moves if TC-012 elects fleet move) | TC-012 |
| `packages/plugins/smart_steer/tests/advisor.client.spec.ts` | test (smart_steer plugin suite) | DOCUMENTED-FORK — in-tree plugin suite (moves if TC-012 elects fleet move) | TC-012 |
| `packages/plugins/smart_steer/tests/dispatcher.spec.ts` | test (smart_steer plugin suite) | DOCUMENTED-FORK — in-tree plugin suite (moves if TC-012 elects fleet move) | TC-012 |
| `packages/plugins/smart_steer/tests/loader-composition.spec.ts` | test (smart_steer plugin suite) | DOCUMENTED-FORK — in-tree plugin suite (moves if TC-012 elects fleet move) | TC-012 |
| `packages/plugins/smart_steer/tests/sections.spec.ts` | test (smart_steer plugin suite) | DOCUMENTED-FORK — in-tree plugin suite (moves if TC-012 elects fleet move) | TC-012 |
| `packages/plugins/smart_steer/tests/side-command.spec.ts` | test (smart_steer plugin suite) | DOCUMENTED-FORK — in-tree plugin suite (moves if TC-012 elects fleet move) | TC-012 |
| `packages/plugins/smart_steer/tsconfig.client.json` | build/package config | DOCUMENTED-FORK — plugin build config | TC-012 |
| `packages/plugins/smart_steer/tsconfig.host.json` | build/package config | DOCUMENTED-FORK — plugin build config | TC-012 |
| `packages/plugins/smart_steer/tsconfig.json` | build/package config | DOCUMENTED-FORK — plugin build config | TC-012 |
| `packages/plugins/smart_steer/tsdown.config.ts` | build/package config | DOCUMENTED-FORK — plugin build config | TC-012 |
| `packages/preset/agent-presets/presets/cordis/agent.cordis.yml` | cordis host registration (smart-steer plugin rows) | PORT-TO-PLUGIN — fleet cordis.patch.yml / preset inject (cordis host stub) | TC-012 |
| `packages/preset/agent-presets/presets/ptc/agent.cordis.yml` | cordis host registration (smart-steer plugin rows) | PORT-TO-PLUGIN — fleet cordis.patch.yml / preset inject (cordis host stub) | TC-012 |
| `packages/preset/agent-presets/presets/standard/agent.cordis.yml` | cordis host registration (smart-steer plugin rows) | PORT-TO-PLUGIN — fleet cordis.patch.yml / preset inject (cordis host stub) | TC-012 |
| `packages/session/README.i18n.yaml` | docs (plugins group map / advisory-runs family / composition graph) | DOCUMENTED-FORK — docs describe in-tree fork; port with fleet docs at repoint | TC-012 |
| `packages/session/README.md` | docs (plugins group map / advisory-runs family / composition graph) | DOCUMENTED-FORK — docs describe in-tree fork; port with fleet docs at repoint | TC-012 |
| `packages/session/README.zh.md` | docs (plugins group map / advisory-runs family / composition graph) | DOCUMENTED-FORK — docs describe in-tree fork; port with fleet docs at repoint | TC-012 |
| `packages/test-support/client-runtime/package.json` | manifest (smart-steer workspace dep for tests) | PORT-TO-PLUGIN — moves with TC-012 feature tests | TC-012 |
| `apps/web/index.html` | UI injection (p2i keyspace v7 pre-seed + legacy carry-over) | PORT-TO-PLUGIN — fleet plugin client.js boot injection | TC-013 |
| `apps/web/tests/advisor-side-command.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/advisor-side-runtime.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/chat-scroll-contract.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/expected/agent-preset-selection/header.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/clickable-links-gallery/ui.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/github-ready-review/conversation-expanded.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/github-ready-review/conversation.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/goal-command-presentation/ui.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/markdown-cjk-strong/ui.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/markdown-images/ui.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/markdown-inline-code-links/ui.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/math-rendering/ui.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/reference-composer/order.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/settings-chrome/dialog-en.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/settings-chrome/dialog.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/sidebar-subagent-activity/owner-running.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/skill-user-invoke/ui-expanded.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/skill-user-invoke/ui.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/stats-paged-history/ui.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/steer-all/mid-steer.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/steer-all/settled-expanded.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/steer-all/settled.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/expected/workspace-new-session-folding/sidebar.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/narrow-landing-e2e.mjs` | test (orphan non-vitest / temporary visual probe) | DROP — retire with P2/P3 follow-up | TC-013 |
| `apps/web/tests/question-composer.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/queue-actions.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/scaffold.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/settings-chrome.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/smart-steer-advisor.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/smart-steer-pipeline.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/smart-steer-pipeline.overlay.yml` | test fixture (e2e overlay) | PORT-TO-PLUGIN — plugin test fixture | TC-013 |
| `apps/web/tests/smart-steer.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/snapshots/streaming-fence-highlight/mid-stream.expected.md` | test fixture (expected snapshot) | PORT-TO-PLUGIN — plugin test fixture (moves with feature) | TC-013 |
| `apps/web/tests/steering.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/subagent-interrupt-ui.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/workspace-management.e2e.ts` | test (web e2e suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `apps/web/tests/zz-countdown-shot.e2e.ts` | test (orphan non-vitest / temporary visual probe) | DROP — retire with P2/P3 follow-up | TC-013 |
| `apps/web/tests/zz-mobile-question-probe.e2e.ts` | test (orphan non-vitest / temporary visual probe) | DROP — retire with P2/P3 follow-up | TC-013 |
| `apps/web/tsconfig.json` | build/test config for web e2e suites | PORT-TO-PLUGIN — plugin test config | TC-013 |
| `packages/client/connection/src/browser-auth.ts` | server auth (deep-route redirect + Secure cookie) | PORT-TO-PLUGIN — fleet ops asset layer (planned home: ops/scripts/tailnet-auth-proxy.mjs) | TC-013 |
| `packages/client/connection/tests/browser-auth.host.spec.ts` | test (browser-auth host suite) | PORT-TO-PLUGIN — plugin test suite | TC-013 |
| `packages/host/frontend-static/README.md` | docs (history-fallback serving contract) | PORT-TO-PLUGIN — plugin docs (moves with feature) | TC-013 |
| `packages/host/frontend-static/README.zh.md` | docs (history-fallback serving contract) | PORT-TO-PLUGIN — plugin docs (moves with feature) | TC-013 |
| `packages/host/frontend-static/src/index.ts` | server asset/serving (history-fallback + cache-control) | PORT-TO-PLUGIN — fleet ops asset layer (planned home: ops/scripts/tailnet-auth-proxy.mjs) | TC-013 |
| `packages/host/frontend-static/tests/frontend-static.spec.ts` | test (serving contract incl. history fallback) | PORT-TO-PLUGIN — plugin test suite | TC-013 |

## Summary

- **Rows:** 231 delta paths (57 added, 174 modified; working tree clean at capture).
- **By card:** TC-008=70, TC-009=30, TC-010=7, TC-011=27, TC-012=51, TC-013=46
- **By class:** DOCUMENTED-FORK=63, DROP=3, PORT-TO-PLUGIN=165
- **DROP rows:** the three temporary/orphan web probes (narrow-landing,
  zz-countdown-shot, zz-mobile-question-probe) per P2/P3 follow-ups.

## Verification

```bash
# 1) row count (expected >= 130; header + separator + 231 data rows = 233)
grep -c '^|' docs/specs/2026-09-24-isolation-delta-register.md
# 2) no unclassified targets (pattern written split so this file itself carries no placeholder substring)
grep -c 'T''BD' docs/specs/2026-09-24-isolation-delta-register.md
# 3) coverage: every raw delta path appears backticked in this register
comm -23 <(sort -u /tmp/p2i-delta-raw.txt | awk '{print $NF}' | sort) \
         <(grep -oE '`[^`]+`' docs/specs/2026-09-24-isolation-delta-register.md | tr -d '`' | sort -u) | wc -l
```

Note: the card's verbatim Step-3 pipeline omits the final `| sort` on input 1,
so input 1 arrives grouped A-then-M instead of path-sorted; `comm` on
unsorted input reports ~159 false "only in input 1" lines even at full
coverage (sort-order artifact, not a coverage gap). The corrected variant
above (both sides path-sorted) is the authoritative coverage check and
outputs `0`.
