# Agent Note: Access trigger discloses menu semantics

Status: implemented

English | [中文](2026-09-13-access-trigger-disclosure-semantics.zh.md)

## Problem

The composer's Access trigger opens a `Menu` but rendered no `aria-expanded` and no `aria-haspopup`. Assistive technology announced a plain button: users could not hear that it discloses a menu, nor that the menu is currently open. The command launcher trigger in the same bar already reflects `aria-expanded`, and a spec pins that contract, so the two disclosure triggers in one composer row disagreed — a live probe of the shipped 0.1.5-rc.2 web build measured `expanded: null` with the menu open.

## Decision

**Every composer trigger that toggles a popup reflects disclosure semantics.** The Access trigger sets `aria-haspopup="menu"` unconditionally (its only popup is the permission menu) and binds `aria-expanded` to the menu's open state. The attributes are fixed tokens, not product copy, so locale ownership and `verify-client-ui-i18n` are unaffected. The permission apply flow, including the Full-access `RiskConfirmation` step, is unchanged.

## Verification

- `packages/client/ui-conversation/tests/input-bar.client.spec.tsx` gains `the Access trigger exposes menu disclosure semantics`: closed → `false`, open → `true`, selection → `false`.
- `pnpm vitest run packages/client/ui-conversation/tests/input-bar.client.spec.tsx` passes; `pnpm run typecheck:contracts-ready` passes after `pnpm run build:lib:host`.

## Alternatives considered

- **Wrap the trigger in a primitive that owns disclosure semantics.** Rejected for this change: the launcher trigger already carries the attributes directly, and routing one attribute pair through a new wrapper adds indirection without deleting owned code.
- **Auto-set `aria-expanded` from inside `Menu`.** Rejected: the anchor element belongs to the feature, and mutating a caller-owned node from the primitive would blur the ownership boundary that keeps `client-ui-primitives` Cordis-free and presentational.
- **Leave it to a broader audit.** Rejected: the asymmetry is pinned by an existing launcher spec, so the fix is a one-line-per-attribute completion of an already-decided contract, not a discovery project.

## Consequences

- Assistive technology announces the Access trigger as a menu button and tracks its open state, matching the command launcher in the same bar.
- Future triggers that toggle popups should copy this pairing (`aria-haspopup` fixed token + `aria-expanded` bound to open state); the new spec test is the behavioral template.
- No runtime, wire, or copy surface changes: closed-state `aria-haspopup`/`aria-expanded="false"` renders no state marker in this repo's Playwright `ariaSnapshot` goldens (the launcher trigger already ships `aria-haspopup="listbox"` and appears bare in the hero golden), so snapshot, locale, and hygiene gates are unaffected beyond the format gates that already pass.
