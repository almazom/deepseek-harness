# Spec: Readiness for dsh-v0.1.7-rc.1 via plugin isolation
Date: 2026-09-24 | Mode: A (interactive, approved by operator)

## Problem / Idea
A new upstream RC is out (`dsh-v0.1.5-rc.3` 2026-09-22, `dsh-v0.1.7-rc.1` 2026-09-23).
The running deployment (`~/projects/dsh-latest` → `dsh-release-0.1.5-rc.2`, shallow
clone, 97 local commits on rc.2, 59 dirty files) must move to the new RC. The
operator's first concern: custom behavior must be isolated to plugin level so a core
swap is survivable. OV audit 2026-09-22 already ruled the current state "clean core +
plugins does not reproduce the system" — the fork is load-bearing.

## Requirements
- Stated: assess health + plugin isolation; become ready to update to the new RC;
  consult OV; brainstorm before acting.
- Implied: no data loss (fleet repo has no remote; dirty state includes untracked
  `packages/core/agent-loop/src/rep-loop.ts`); production (close-reading.ru/dsh via
  symlink + launchd KeepAlive) must not break; rollback must stay seconds-fast.
- Constraints: ADR 2026-09-03 — never git-pull the served tree; upgrade = fresh clone
  + `dsh-latest` symlink repoint. Golden rule (plugins/AGENTS.md, directive 2026-09-21):
  every change gets a plugin scope, no monkey-patching, artifacts survive `git pull`/
  core release bumps.

## Current-state findings (2026-09-24)
- Typecheck RED: `packages/api/session-controller/src/list.ts(339)` TS2322/TS2542,
  `InboxWireState` index-signature errors — in local uncommitted edits.
- Fleet smoke gate RED (`smoke-all.sh` exit 1): coverage gaps
  `compaction/dsh-compact-as-kimi/`, `decisions/dsh-adr-urge/`.
- Fleet repo `~/projects/dsh/plugins`: 15 modified files uncommitted, untracked WIP,
  **no remote**.
- Isolated ✅: profile `link:`+bundles mounts, proxy-layer UI injection
  (`tailnet-auth-proxy.mjs` + fleet asset symlinks), MCP config in `~/.dsh/settings.yaml`,
  most fleet plugins (package-name imports only, no core writes).
- NOT isolated ❌: 58 of 97 local commits touch core (`packages/core`,
  `packages/client`, `apps/web`, `packages/interaction`; 127 unique files under
  `packages/client|apps/web`); untracked `packages/core/agent-loop/src/rep-loop.ts`;
  `smart_steer` lives inside the core tree at `packages/plugins/smart_steer`;
  dirty `tool-ask-user` / `agent-loop` / `session` edits.

## Approaches considered
- **A — patch-forward rebase onto new RC.** Fast to a running RC; 16k+ upstream
  commits vs 127 local UI files = brutal conflict surface; debt never repaid.
- **B — big-bang fresh clone + plugins only.** Cleanest end-state; will not boot —
  58 core-touching commits have no plugin home yet.
- **C — staged: stabilize → isolate → symlink repoint.** Most work, but each phase
  independently valuable and rollback-safe at every step.

## Decision + Rationale
**Option C (operator-selected), upgrade target `dsh-v0.1.7-rc.1`
(operator-selected over rc.3; note ~19.7k-commit distance — isolation must be
complete before the repoint).** Rationale: isolation is the precondition for a fast,
repeatable RC upgrade under the symlink ADR; doing it staged keeps prod up and makes
future RC bumps seconds-fast instead of a rebase project.

## Scope
**In — Phase 1 (stabilize & backup, this spec's only executable phase until re-approved):**
1. Fix the red typecheck (session-controller `list.ts`, `InboxWireState`).
2. Commit all local core work in logical stacks (incl. decide fate of untracked
   `rep-loop.ts`: commit or park).
3. Commit fleet repo WIP; **create a private GitHub remote for `~/projects/dsh/plugins`
   and push** (off-box backup).
4. Close the 2 smoke-gate gaps (smoke test or explicit archive) until `smoke-all.sh`
   exits 0.
5. Re-run `pnpm run typecheck` + `pnpm run test` + fleet gate → all green.

**In — Phase 2 (isolation sprint, separate approval):** port each core-touching
change to a plugin/proxy home (ui-workspace/ui-chat deltas → fleet `client.js`/proxy
injection; `tool-ask-user` deltas → plugin or drop; `rep-loop` → plugin or drop;
`smart_steer` → keep as documented fork package or move to fleet). Success = a
clean upstream clone + fleet + profiles reproduces the running system.

**In — Phase 3 (upgrade, separate approval):** fresh clone of `dsh-v0.1.7-rc.1` into
`~/projects/dsh/dsh-release-0.1.7-rc.1`, `pnpm install && pnpm run build`, remount
profiles, smoke, repoint `dsh-latest`, verify close-reading.ru/dsh; rollback = repoint
back.

**Out:** any core feature work; `0.1.5-rc.3` target evaluation; touching launchd
KeepAlive; upstream PRs of local fixes (optional follow-up).

## Acceptance criteria
- Phase 1: `pnpm run typecheck` exit 0; `pnpm run test` exit 0; fleet
  `smoke-all.sh` exit 0; `git status` clean in both repos; fleet repo has an
  origin and `git push` succeeds (verify with `git ls-remote origin`).
- Phase 2: clean clone + `link:` mounts + proxy assets boots a session exhibiting
  chat/workspace/ask-user/smart-steer behavior (manual smoke via web profile).
- Phase 3: `dsh-latest` → 0.1.7-rc.1 tree, web profile loads on :3080, rollback
  repoint tested once.

## Open questions
- `alien/` untracked dir in fleet — keep, archive, or delete?
- smart_steer: fleet migration or documented fork package? (decide in Phase 2)
- Phase 3 must re-verify whether `0.1.7-rc.1` changed session format / profile patch
  schema before repoint (check `docs/session-format-status.md` at that tag).
