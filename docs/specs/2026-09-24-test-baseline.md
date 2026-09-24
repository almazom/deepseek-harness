# Test baseline — 2026-09-24 (TC-002)

**Status:** complete — 0 unresolved entries carried forward.
**Tree:** `/Users/mac-mini-m4-almazom/projects/dsh/dsh-release-0.1.5-rc.2` (shallow root `c291e7961a` = "pre-existing on c291e7961a" reference; worktree contains uncommitted WIP + local-only commits).
**Acceptance:** `pnpm run test` exits 0 with no expected-failure list; no test was deleted, no retry/timeout was bumped to hide a failure.

## Run history

| Run | Command | Result |
| --- | --- | --- |
| Readiness probe (m00092) | `pnpm run test` | 55 failed / 22,802 tests, 20 failed files, 24 errors (175.84s) |
| Run 1 (`/tmp/p2i-test-run.log`, fs-sandbox restricted) | `pnpm run test` | 19 failed files / 54 failed tests / 24 errors — harness EPERM artifacts (mkdtemp, posix_openpt, spawn), not repo failures |
| Run 2 (`/tmp/p2i-test-run2.log`, unrestricted) | `pnpm run test` | 12 failed files / 13 failed tests / 21 unhandled FileHandle errors, 173.85s, exit 1 |
| Fix batch 3 (`/tmp/p2i-tc002-batch3.log`) | `pnpm exec vitest run <13 files>` | 13/13 files, 399/399 tests, exit 0 |
| Final verification (`/tmp/p2i-verify-tc002.log`) | `pnpm run test` | exit 0 (see §Verification) |

Run-1's sandbox-only files (fs-sandbox, tool-bash-persistent/loader-composition, subprocess-local/process-exit, terminal-bash/local, tool-terminal/loader-composition, scripts/run-gates, scripts/snapshot-workspace-parent) went green under unrestricted execution and are not triage entries.

## Baseline entries (unresolved failures carried forward)

**None.** Every failed file from the readiness probe and run 2 was fixed in-tree. The suite must pass with an empty baseline — any future entry needs the exact error plus evidence (commit hash or "pre-existing on c291e7961a").

## Triage record

Classification key: **dirty** = broken by uncommitted worktree changes; **local-commit** = broken by a commit after `c291e7961a` that exists only in this clone; **environmental** = broken by ambient process environment or the documented `~/projects/dsh-latest` symlink workflow; **pre-existing** = faulty on the clean base tree.

### Dirty-induced (uncommitted agent-loop auto-continue WIP)

Root cause shared by all five: uncommitted `packages/core/agent-loop/src/agent.ts` added auto-continue (`AUTO_CONTINUE_BOUND = 2`) for non-empty `max-tokens` turns, so a scripted single `max-tokens` response is followed by one/two automatic continuation requests. MockAdapter scripts exhausted → turn ended `error` instead of durable `max-tokens`. Evidence: spec files last touched at `c291e7961a`; broken by dirty `packages/core/agent-loop/src/agent.ts`.

| File | Exact error (run 2) | Resolution |
| --- | --- | --- |
| `packages/acp/acp/tests/turns.spec.ts:35` | `MockAdapter: script exhausted` → `reports a max-token turn without losing its committed text` got `error` | script now supplies 3 × `maxTokensResponse` (bound 2 + durable); joined `messageText` preserved via 2-element text entry |
| `packages/goal/goal-round-driver/tests/goal-round-driver.spec.ts` | `disarms automatic continuation after a max tokens`: expected `requests` length 1, got 2 | it.each max-tokens case uses `maxTokensResponse('')` — empty content never auto-continues, durable on request 1 |
| `packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts:149` | `later metadata appended during flush`: turn/end seq mismatch (auto-continuation consumed a script slot) | 3 × `maxTokensResponse('partial answer')` |
| `packages/subagent/subagent-spawn-in-process/tests/subagent-spawn-in-process.spec.ts:164` | expected `'error'` to be `'max-tokens'` | 3 × `maxTokensResponse('cut off')` |
| `packages/subagent/subagent/tests/continuation.spec.ts:35` and `:2526` | expected `'error'` to be `'max-tokens'` (1875); `delivers the terminal reason when the child never had a chance to report` got `finished... parent ack` (2526) — auto-continue consumed `textResponse('parent ack')` | both scripts use 3 × `maxTokensResponse`; last non-empty assistant message stays the scripted closing text (`finalAssistantOutput` selection rule) |

### Dirty-induced (uncommitted day-groupBy WIP)

| File | Exact error (run 2) | Resolution |
| --- | --- | --- |
| `packages/client/ui-workspace/tests/workspace-browser.client.spec.tsx` | `groups by timeline buckets whose rows read Workspace · time`: expected `'today-one刚刚'` to contain `'alpha'` | completed the WIP wiring: `deriveDayGroups` takes `workspaces`, builds `workspaceBySession` (first-wins), labels sessions with their Workspace title; `SessionBrowserCore.tsx` passes `workspaces` into `DayList`; new regression test in `tree.client.spec.ts` |

### Local-commit-induced (commits after c291e7961a, clone-local)

| File | Evidence | Exact error (run 2) | Resolution |
| --- | --- | --- | --- |
| `packages/client/ui-layout/tests/page-path-bridge.client.spec.ts` | last touch `987b29d438` (+ `68d7dab56f` expectations) | line 37 `returnToBase` expected `''`, got `'?token=abc'` | impl `returnToBase` strips the query (`target.search = ''`); `push()` still preserves `?token=abc` per its contract |
| `packages/host/frontend-static/tests/frontend-static.spec.ts` | last touch `6bf052a3c0` | HEAD `/` toEqual missing `cache: 'no-cache'`; 404 toEqual missing `cache: null` | spec expectations aligned with the committed cache-control behavior (HEAD no-cache, 404 no cache header) |
| `packages/typert/generator/tests/cordis-catalog.spec.ts:83` | broken by dirty agent-loop `StepEndReason` union | committed `TurnEndReasonMap` lacked `'rep-loop-detected'` entry the fresh render contains | regenerated `packages/extensions/tool-cordis/src/api-catalog.ts` via `pnpm run gen-cordis-catalog`; `pnpm run verify-cordis-catalog` → CHECK_EXIT=0 |

### Environmental (ambient process environment / symlink workflow)

| File | Exact error (run 2 / full run) | Evidence | Resolution |
| --- | --- | --- | --- |
| `packages/util/native-command/tests/native-command.spec.ts:22` | received stderr `boom(node:53459) WARNING: Exited the environment with code 3` — expected `'boom'` | ambient `NODE_OPTIONS=--trace-exit` in the launching shell (not in repo or shell rc); spec last touch `c291e7961a` | spec owns its child env: `vi.stubEnv('NODE_OPTIONS', '')` in `beforeEach` |
| `scripts/oxlint-contract.spec.ts` | expected `''` got `"(node:54239) WARNING: Exited the environment with code 0"` at the stderr-clean assertion | same ambient `NODE_OPTIONS`; both `runOxlint`/`runRepositoryOxlint` helpers inherited `process.env` | spawn env now pins `NODE_OPTIONS: ''` after `NO_COLOR`, before caller `env` overrides |
| `scripts/browser-bundled-externals.spec.ts` | `RollupError: [vite:build-html] The "fileName" or "name" properties of emitted chunks and assets must be strings that are neither absolute nor relative paths, received "../../../../../../../../private/var/folders/…/dsh-browser-notices-VNiMI0/apps/web/index.html"` at `collectShell scripts/browser-bundled-externals.ts:140:5` | macOS `/var → /private/var` symlink: lexical `mkdtempSync(tmpdir())` root vs Vite's resolved real input path produced a `../`-escaping asset name | `fixture()` roots in `realpathSync(tmpdir())` so lexical and resolved paths agree |
| `packages/shell/bash-local/tests/executor.spec.ts:64` | `defaults cwd to process.cwd()`: expected `…/dsh-release-0.1.5-rc.2`, got `…/dsh-latest` | pre-existing on `c291e7961a` under the documented `~/projects/dsh-latest` symlink workflow: ambient shell `PWD` (logical symlink path) leaks into spawned bash, whose `pwd` prints `$PWD` while `process.cwd()` is the resolved path (first surfaced in the full run, not run 2, when the launching shell's `PWD` differed) | spec owns its child env: `vi.stubEnv('PWD', process.cwd())` in `beforeEach`; 30/30 pass |

### Pre-existing on c291e7961a (known failure named by the card)

| File | Exact error | Evidence | Resolution |
| --- | --- | --- | --- |
| `packages/experimental/agent-team/tests/team.spec.ts` | 21 × unhandled `Error: A FileHandle object was closed during garbage collection. This used to be allowed with a deprecation warning but is now considered an error. Please close FileHandle objects explicitly. File descriptor: 31 (…/dsh-team-PYbJKw/_no-cwd/lead/session.lock)`, `Serialized Error: { code: 'ERR_INVALID_STATE' }` | last touch `c291e7961a`; `afterEach` only `rmSync`'d roots and never disposed the per-test `Context`, so jsonl persistence's write-lease handles for `session.lock` survived to GC | teardown now disposes every recorded `Context` (`await ctx.fiber.dispose()`, tracked in `setup()` and both inline-`Context` tests) before removing roots, mirroring `persistence.spec.ts`; disposal drives `session/disposed` → writer `close()` → `lease.release()`, i.e. explicit session-lock closure, errors aggregated (not swallowed) |

## What was deliberately NOT done

- No test deleted, skipped, or `.todo`'d to reach green.
- No retry/timeout bumps (team.spec keeps `disposalTimeoutMs` cases as written; grace periods untouched).
- No agent-team architecture rewrite: the FileHandle fix is teardown disposal only.
- The uncommitted agent-loop auto-continue WIP was not reverted; its specs were adapted to the new contract because the WIP is part of the tree's intended feature set (its own card owns the feature).

## Verification

```bash
cd /Users/mac-mini-m4-almazom/projects/dsh/dsh-release-0.1.5-rc.2 && pnpm run test > /tmp/p2i-verify-tc002.log 2>&1; echo "EXIT=$?"
```

**Expected:** `EXIT=0`, `Test Files  0 failed`, no `Unhandled` errors — zero entries in this baseline means zero tolerated failures.
