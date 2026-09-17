# Agent Note: Advisor sheet mobile layout contract

Status: implemented

English | [中文](2026-09-17-advisor-sheet-mobile-layout-contract.zh.md)

- Kind: bug-fix
- Scope: packages/client/ui-conversation
- Date: 2026-09-17

## Problem

A real-device screenshot of the Smart-steer advisor sheet on a 430×932 phone showed overlapping text layers. A Playwright probe of the built bundle at 390×664 and 430-wide touch viewports reproduced none of it — one dialog, header at the card top — while the review of the same surface confirmed four real mobile defects regardless of which build produced the screenshot: the Modal header lives inside the scroll container, so scrolling the snapshot moves the title and the only close affordance out of view; the footer actions and the close button render at 28 px against the 44 px HIG minimum; the sheet caps at `min(72vh, 560px)` where iOS dynamic chrome makes `vh` unstable; and the verdict sat last, below the pipeline rows, although the decision is the reason the sheet opens.

## Decision

`AdvisorSheet` leaves the shared `Modal` primitive untouched and turns its `contentClassName` into a pinned frame: the frame is `flex: 1; min-height: 0; overflow: hidden`, and its last structural child (Modal's internal body wrapper, which has no class hook) becomes the flex column carrying the scroll area. Header, close button, and footer stay put; only the snapshot scrolls. The children root is the single scroll container. Content order is gate → verdict → snapshot rows → pipeline: the decision first, then the facts that produced it, with the per-phase breakdown last. The pipeline detail text refers to "the snapshot above" and stays truthful because the rows sit directly above the pipeline. Block separators (`border-top` on the verdict and rows blocks) mark the three reading zones; the gate opens the sheet without a top border.

On coarse pointers every button inside the sheet lifts to `min-width`/`min-height: 44px` (`@media (pointer: coarse)`), covering the `Button size="sm"` actions (28 px) and the close button (28 px) without branching the primitive's geometry for desktop. The sheet keeps the `vh` declaration before `dvh` so browsers without `dvh` get a fallback; the frame contract assumes the Modal DOM (header and body inside `.content`), so a Modal DOM change surfaces here first — as an unpinned advisor header.

## Alternatives considered

- Patch the `Modal` primitive with a `headerClassName` and a pinned-header mode — rejected: every other Modal consumer would absorb a layout mode it does not use, and the change would touch a cross-package primitive for a single-sheet contract.
- Fix only the reported overlap and wait for a reproducible build — rejected: the heuristic review confirmed the four defects structurally, independent of which build produced the screenshot.
- Branch the sheet's geometry on a UA sniff instead of `pointer: coarse` — rejected: media queries track the input modality the 44 px rule exists for; UA strings rot.

## Consequences

- The Modal primitive is unchanged; all other Modal consumers keep their current geometry.
- The frame targets the body wrapper structurally (`:last-child`) — a relationship documented in a CSS comment for its single consumer; it is not reusable as a general Modal layout.
- Localized text, the `role="dialog"` naming, and button labels are unchanged, so replay-e2e selectors and model-visible behavior are untouched.
