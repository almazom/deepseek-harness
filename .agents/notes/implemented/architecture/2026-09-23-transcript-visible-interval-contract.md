# Agent Note: the visible interval is the contract — transcript row rhythm

Status: implemented

## Problem

The operator reported, from a phone recording, that neighbouring rows in the chat
transcript read as an uneven column: one-line `Edit` rows sat visibly further from
their neighbours than the `Bash`/`Thought` rows around them. The first pass made
the *box* interval uniform — every pair of rows had the same 16px of margin
between their boxes — and the operator reported no visible change. That
correction is the point of this note: the box interval is not what the eye reads.

Measured live at 1440x900 over 79 flow items with the probe added here
(`plugins/ui/dsh-mobile-ui-inject/probes/transcript-rhythm.mjs`):

- box gaps: one value (16px), while the visible text gap ran **8–44px over 12
  distinct values**;
- one-line `Edit`/`Read` rows were **44px** tall (an earlier operator rule made
  step rows >=44px touch targets) while `Bash` rows were **18px**, so one token
  produced a 42px visible gap beside a 24px one;
- a row ending in a text block exported its last line's trailing half-leading and
  its paragraph's bottom margin into the row box, adding 5–6px after it;
- the last class came from measuring the operator's own parallel session: of 24
  one-line rows, 13 were 18px and 11 were 25px, and **every 25px row carried an
  inline pill** (`OV recall`, `OV read`) — the row dump shows
  `span.<hash>_summary { height: 25px; line-height: 18px }`.

## Decision

1. **The visible interval is the contract.** For two neighbouring rows it is
   `air(previous row) + flow token + air(next row)`. The column owns the token;
   the other two terms are defects unless they are the row's own typography.
2. **One row height for every one-line step row: 25px**, the height the inline
   pills already force. The operator chose this over shrinking his badges, and
   over the 44px touch-target floor it replaces.
3. **Air is removed at its source, not compensated per pair**, wherever it can be:
   a row's trailing paragraph margin and half-leading, the `.source` carrier of a
   context-injection row, the shared row box height. Where a neighbour's air is
   unavoidable (after an expanded thought block; at the turn tail) that pair gets
   the token minus the measured air — the compensating shape upstream used for its
   process-answer rule.
4. **The gate measures flow items, not row units**, because an expanded tool card
   keeps its body as a sibling of the title row: judging row boxes reported four
   pairs as 8px defects that were not defects.
5. **The gate judges the visible metric**: a pair fails only when it is *wider*
   than the token plus the two neighbours' measured typographic air plus 2px of
   rounding slack. A pair tighter than the token is content overflow, reported,
   not failed.
6. **Step rows step 4px out to the left of the message text** (operator, voice
   2026-09-23 22:37): the row box that owns a title takes `margin-left: -4px`,
   one parallel offset for every step row, no outline of any kind, so the bright
   conclusion text gains volume. Measured: row box at 480 against the text column
   at 484; every tool row's text at 502 (was 506).

## Process lesson

A fix-round claim was falsified because a scripted patch replaced nothing (its
anchor did not match) while reporting success: the metric it claimed to install
was never in the file, and its README documented behaviour that did not exist.
Every patch in this work is followed by a grep for the string it introduced, and
every gate run reports the numbers it actually measured.

## Files

- `plugins/ui/dsh-mobile-ui-inject/probes/transcript-rhythm.mjs` (gate, added)
- `plugins/ui/dsh-web-almaz-mobile-v2/lib/client.js` (row height, trailing air,
  pair compensation, 4px outdent)
- `packages/client/ui-chat/src/client/chat/{ChatView,ContextInjectionRow,ReasoningRow,TurnProcessNodeView,TurnTailNodeView}.module.css`
  and `packages/client/ui-chat/tests/turn-tail-spacing.client.spec.ts`
- Plan and numbers: `plans/2026-09-23_transcript-vertical-interval.md`

## Alternatives considered

- **Keep gating the box gap.** It was already uniform and the operator could not
  see it; a green gate over an unchanged screen is worse than no gate.
- **Keep the 44px touch targets and accept mixed heights.** Rejected by the
  operator: interval consistency outranks the target size. Consequence recorded:
  step rows pass WCAG 2.5.8 only through its spacing exception.
- **Flatten the inline pills to the 18px line box.** Rejected: the pills are the
  operator's own state markers and keep their shape.
- **Compensate every row kind with its own constant.** Measured air varies 0–6px
  with the last line's inline content (code spans, cards), so a per-kind constant
  leaves a 2px spread and is not maintainable.

## Consequences

- Every one-line row is 25px: 50/50 in the rich session and 30/30 in the
  operator's, at 1440x900 and at 390x664; dominant visible cadence 25px (44 of 79
  intervals).
- No pair is wider than token + neighbours' air + 2px in three sessions plus the
  phone viewport, where the same column previously read 8–44px.
- Residuals, measured and accepted: four pairs read 8px because a failed-tool
  row's content overflows its row box (containment, not spacing); pairs adjacent
  to an expanded thought block or the turn tail still vary 1–3px with the last
  line's inline content.
- The gate is the enforcement point; it reports the visible histogram, the text
  cadence, the offending pairs, the left edges per row kind and each flow item's
  box and ink.
