# Browser-video-record skill: recording doctrine for any Playwright testing

2026-09-20 · scope: new skill `.agents/skills/browser-video-record/` (no product code touched)

## Why a skill, not a Cordis package

"Any testing" in this fleet happens in shell scripts, audit skills, and e2e
runs — not through harness tools. A Cordis capability seam (Service
Definition/Provider/Consumer) would touch the product API spine for something
every consumer already reaches via bash. Skills are the repo's agent-facing
plugin layer (precedent: `record-browser-gif`); the helper is plain ESM with
zero dependencies, resolved per-checkout (`apps/web/package.json`), so the
skill travels with the repo without a versioned dependency edge.

Supersession scope: partial. The capture mechanics this note generalizes were
first recorded in the [playwright-video-gif note](2026-09-08-playwright-video-gif.md);
that note stays authoritative for GIF demo encoding and PR evidence chains.

## Banner over Test-runner annotations

Playwright Test's `video: { show: { actions } }` annotates videos, but the
repo (and every fleet consumer) uses library playwright, where `recordVideo`
is `{ dir, size }` only (verified in playwright-core 1.61.1 types). The
in-page `#pwr-step-banner` overlay + `events.json` is runner-independent and
keeps the alignment ground truth inside the artifact itself — any player or
VLM sees step labels without sidecar logs.

## Pipeline adaptations (p2i run 2026-09-20)

- Card package under gitignored `.playwright-mcp/p2i/` per the 2026-09-19
  workspace-scoped law (global `~/.plan` is out).
- Local commit of skill paths only; no push, no `gh repo create` — release
  checkout with unrelated dirty files (docs/config-catalog.*, packages/goal).
- Phase 5d browser-proof skipped: no shipped web surface; usage proven by a
  real TC-004 recording instead.
- Cross-harness judge (G3) deferred under quota NOPE; in-harness fresh-subagent
  optics ran as the adversarial layer. Deferred ≠ PASS.

## Evidence

PoC + validation recordings: `.playwright-mcp/video-poc/` (REPORT.md,
demo-behavior.webm/.mp4, demo-via-skill/). VLM recovered all scripted events
with ±1–1.5s unmarked; the banner closes that gap by construction.
