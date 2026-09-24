# Spec: Semantic Navigator — карта семантических единиц в сайдбаре DSH Web GUI

Date: 2026-09-24 | Mode: collective brainstorm (auto-decided; operator delegated both forks via "Collective decision (brainstorm)")
Status: awaiting operator approval (HARD-GATE A — no implementation before sign-off)

## Problem / Idea

Operator idea (screenshot + voice of 2026-09-24): the sidebar's "active" filter usually leaves a large empty vertical area above Settings. Split that freed space in two and show where the current session is moving — a map of the semantic units belonging to it.

Pain behind the idea: after a long session (30+ min, compactions) the operator loses the thread — "what was this session about and where is it going?" The panel is a navigation display for the session.

## Requirements

**Stated**
- Freed bottom sidebar space is split into two parts.
- Upper/lower parts visualize the semantic units of the current session and its direction of movement.

**Implied**
- Semantic units are formed with small-LLM assistance over an event digest of the dirty tail only (operator directive 2026-09-24: LLM unit formation is allowed). Deterministic signals pre-cut candidate boundaries — user prompts as hard boundaries, todo_write transitions, compaction summaries, time gaps, tool-call clusters (the semantic-islands boundary signal set) — and the model names units and merges/splits candidates.
- Unit labels are ≤4 words; clicking a unit jumps the transcript to its first message.
- The map updates on demand: a refresh button shows when updates exist (stale badge with the count of new events) and runs the incremental updater — never per tool call, never a full-log reprocess. Operator choice 2026-09-24: strictly manual, no idle auto-refresh.

**Constraints**
- Sidebar column ~280px wide; must be scannable in under 5 seconds.
- No duplication of existing single sources of truth: TurnNavigator (turn level), TrajectoryView (model tool trajectory), ContextMeter ring near the composer (context budget).
- No new model-visible inputs: the panel is a read-only projection of logged events, so the "Model-visible ⟺ logged" invariant is untouched; no agent-loop changes.
- Client UI copy is locale-owned (typed dictionaries + `t`); `verify-client-ui-i18n` must pass.
- Rendering lives in a sidebar slot (slot system), not a fork of foreign UI structure.
- Sealed units are immutable: a refresh may only re-cut the open tail unit and at most one unit before it, so the geography the operator learned stays stable.
- Every model call is bounded: event-digest budget (~6K tokens) plus a carry summary of recent units; the full session log never reaches a model.
- Model unavailability (quota, crash) degrades to deterministic labels (user→user windows, compaction summaries) — the map keeps updating.

## Approaches considered

### Option A — Route line (metro-style) ✅ chosen
Vertical line: stops = semantic units, segment length ∝ unit size, "◉▶ you are here" marker with forward arrow, click = jump.
- Trade-offs: stable layout, readable labels at 280px, honest order+size encoding; does not show inter-unit similarity.

### Option B — 2D constellation (rejected for sidebar)
Unit nodes in a plane + comet trail of trajectory.
- Trade-offs: shows clusters attractively; generated layout jitters on every new event, distances fake precision, label hover only, highest maintenance. Kept as a candidate for the right-sidebar Trajectory tab.

### Option C — Compass only (rejected as underpowered)
Heading arrow + last 3 units as chips.
- Trade-offs: cheapest, but answers "where to" without "where have we been" — misses the core pain.

### Lower half options
1. Compass: destination (goal) + work phase (explore 🔍 → build 🔨 → verify ✅, by tool mix) + topic-drift vector. ✅ chosen
2. Mini event ticker. Rejected: repeats the transcript already on screen.
3. Instruments: context budget + quota. Rejected: duplicates the existing ContextMeter ring (double-encoding the same quantity).

## Decision + Rationale

AUTONOMOUS DECISION (collective brainstorm, 2026-09-24; the operator delegated both forks via "Collective decision (brainstorm)").

- MAP = A (route line); LOWER HALF = 1 (compass).
- Rationale: only 1D position + segment length honestly encode sequence and size (Tufte data-ink and lie-factor), labels stay readable in a 280px column (Nielsen information scent), and it is the smallest artifact that answers both "where have we been" and "where are we going" (Rams "less but better"). A 2D layout jitters and fakes precision.
- Three optics (UX, data-viz, scope skeptic) converged; dissent: none. Quota preflight was NOPE (`max_safe_n: 0`), so the collective ran as an in-session multi-optic debate instead of subagent fan-out.
- Direction means three instruments, all shown in the compass: course to goal (goal/todo as destination), topic drift (sliding window over unit labels), work phase (tool mix).
- Operator directive (2026-09-24): LLM formation of thematic units is allowed; updates run from the change point over a bounded tail to a small model, never the full context.
- Operator choices (2026-09-24): unit naming = cloud flash model only; refresh = strictly manual button.
- reversible: yes — revisit any time.

## Incremental update algorithm

Map state is a sidecar artifact per session: `units[]` (sealed), `open` (mutable tail unit), `watermark` (last processed event seq), `logVersion`.

```
лог:  [■■■■ sealed ■■■][▓▓ open ▓▓][··· новые события ···]
                         ▲ точка измерения = start(open), не конец лога

update():
  tail = события(watermark..now); if пусто → «карта актуальна», стоп
  digest = compress(tail)        # user — verbatim, tools — кластерами, compaction — verbatim
  carry = summary(open) + метки последних 3 sealed     # «эхо» прошлого, ~150-300 токенов
  if len(digest) > BUDGET:                            # первый билд / длинный AFK-разрыв
      for chunk in chunks(digest, BUDGET):
          carry, units += small_model(carry, chunk)    # сканирующая цепочка
  else:
      units', open' = small_model(carry, digest)       # один вызов
  ревизия ≤2 единиц: open и ≤1 перед ним; sealed не трогаем
  seal единиц с подтверждённой границей (новый user-turn / todo-флип / compaction)
  watermark = now; persist(state)
```

Rules that keep the map honest and stable:
- Dirty point is the start of the open unit, not the log end: its label is provisional until a boundary confirms it, and a later compaction summary may still upgrade the label.
- Sealed means sealed: no renames, no re-cuts. Revision depth ≤2 units, so click-to-jump anchors and the learned route hold.
- `BUDGET ≈ 6K` tokens of digest (config `semanticMap.digestBudget`, not hardcoded). Digest compresses raw tool noise ~10×: a 50K-token tail ≈ one call.
- Chunked scan for big tails: a first build over a 1M-token session ≈ 20 bounded calls; a routine refresh after one turn ≈ one call of ~2K tokens. Nothing ever sends the whole session to a model.
- Fallback: with no model available the same pipeline runs with deterministic naming (user→user windows + compaction summaries) — worse labels, same route shape.
- Same watermark transaction shape as the compaction research in OpenViking (semantic-islands R&D: hybrid segmentation + watermark atomicity) — the map is one more projection over the lossless log.

## Scope

**in**
- Semantic-unit formation: deterministic pre-cut + small-LLM naming/merging over the dirty-tail event digest; compaction summary is the preferred label source.
- Incremental updater (dirty point + bounded digest + carry echo) and its sidecar state per session.
- Refresh button with stale badge ("N new events") in the panel header.
- Route-line panel (upper half) with click-to-jump and "you are here" + direction arrow.
- Compass panel (lower half): goal pill, phase chip, drift vector.
- Gate: panel data only at ≥5 units; below that a "session too fresh" stub.
- Locale dictionary entries for all copy; keyless recorded-session snapshot update.

**out**
- 2D constellation layout (candidate for the right-sidebar Trajectory tab).
- Full-log reprocessing on refresh and per-tool-call map updates (the updater runs on button press only).
- Agent-loop changes and new session events.
- Context/quota instruments (ContextMeter remains the single source).
- Coupling to the "active" filter: the panel lives while a session is open (the filter merely frees the space). Operator may re-couple later.

## Acceptance criteria

- The panel renders the route from a recorded-session log; a refresh after new events issues bounded model calls over the dirty-tail digest only and never sends the full log to a model.
- Sealed units stay byte-identical across refreshes; only the open tail and ≤1 unit before it may be re-cut.
- With no model available the map still updates with deterministic labels.
- The refresh button shows a stale badge with the new-events count and clears it after a successful update.
- Clicking a unit scrolls the transcript to its first message.
- Compass shows goal (or "no goal"), phase ∈ {explore, build, verify}, and a drift vector.
- Sessions with fewer than 5 units show the stub and no panel data.
- `verify-client-ui-i18n` passes; no agent-loop diff; recorded-session snapshot expectations updated.

## Open questions

- Final product name: «Семантический навигатор» / Semantic Navigator.
- Unit boundary rule: user→user windows win; compaction summaries are the label source (alternative: compaction events as hard boundaries).
- Activation rule: session open + ≥5 units (decoupled from the "active" filter — confirm with operator).
- Route on approval: p2i pipeline (2+ files, end-to-end delivery); if the operator wants a dev plan first → writing-plans.
- Unit-naming model: cloud flash only (operator choice 2026-09-24; glm-5.3-flash vs deepseek-v4.1-flash — pin one at implementation). Quota exhaustion keeps the deterministic-labels fallback load-bearing.
- Digest budget default (~6K) and chunk size for the first build; confirm.
