# Agent Note: Advisor sheet mobile layout contract

Status: implemented

[中文](2026-09-17-advisor-sheet-mobile-layout-contract.zh.md) | English

- Kind: bug-fix
- Scope: packages/client/ui-conversation
- Date: 2026-09-17

## Problem

A real-device screenshot of the Smart-steer advisor sheet on a 430×932 phone showed overlapping text layers. A Playwright probe of the built bundle at 390×664 and 430-wide touch viewports reproduced none of it — one dialog, header at the card top — while the review of the same surface confirmed four real mobile defects regardless of which build produced the screenshot: the Modal header lives inside the scroll container, so scrolling the snapshot moves the title and the only close affordance out of view; the footer actions and the close button render at 28 px against the 44 px HIG minimum; the sheet caps at `min(72vh, 560px)` where iOS dynamic chrome makes `vh` unstable; and the verdict sat last, below the pipeline rows, although the decision is the reason the sheet opens.

## Decision

`AdvisorSheet` keeps the shared `Modal` primitive untouched and turns its `contentClassName` into a fixed frame: the frame is `flex: 1; min-height: 0; overflow: hidden`, and its last structural child (the Modal-internal body wrapper, which has no class hook) becomes the flex column that hosts the scroll region. The title, close button, and footer therefore stay pinned while only the snapshot scrolls. The children root is the single scroll container. The content order is gate → verdict → snapshot rows → pipeline: the decision first, the facts that produced it after, and the phase-by-phase reasoning last. The pipeline's detail copy references "the snapshot above", which stays true because the rows remain immediately above the pipeline. Separators (`border-top` on the verdict and rows blocks) mark the three reading zones; the gate opens the sheet with no top border.

Coarse pointers lift every button inside the sheet to `min-width`/`min-height: 44px` (`@media (pointer: coarse)`), covering the 28 px `Button size="sm"` actions and the 28 px close button without forking primitive geometry for desktop. The sheet keeps a `vh` declaration before `dvh` so browsers without `dvh` fall back, and the frame contract assumes the Modal DOM (`header` then `body` inside `.content`); a Modal DOM change would surface here first, as a visibly unpinned advisor header.

## Consequences

- The Modal primitive stays unmodified; every other Modal consumer keeps its current geometry.
- The frame targets the body wrapper structurally (`:last-child`), a single-consumer coupling documented in the CSS comment; it is not reusable as a generic Modal layout.
- Locale copy, `role="dialog"` naming, and button labels are unchanged, so the replay e2e selectors and the model-visible behavior are unaffected.
