# Agent Note: Released v4 opens the Session header origin to headless

Status: implemented

English | [中文](2026-09-17-released-v4-headless-origin.zh.md)

## Problem

A Session header may record `origin: "subagent"` since the released v2 format, and every consumer that must treat subagent sessions specially tests for that value. The one-shot headless runner creates ordinary Sessions, so a scripted run is indistinguishable from an operator-opened Session in every stored header, and no consumer can ever tell them apart.

## Decision

`SESSION_FORMAT_VERSION` moves to 4 through the standard adjacent-migration mechanism in the [released migration note](2026-08-31-released-session-format-migrations.md). Version 4 changes exactly one admission rule: the durable header `origin` field accepts `"headless"` alongside `"subagent"`. No event type, payload member, or other header field changes, so the [v3-to-v4 conversion](../../../../packages/session/session-format-v3-to-v4/README.md) is an identity that retargets the header version and revalidates the widened origin; it borrows the frozen released-v3 codec rows as a placeholder rather than duplicating framing code.

The widened rule lives in one place per concern. The released edge validates the v4 header. The current Session runtime accepts both values when attaching `origin` from creation meta and still refuses anything else. Subagent-only semantics — descendant indexing, the subagent ownership fence, and the runner's refusal to adopt sessions with a `subagent` parent — keep testing for `subagent` and never branch on `headless`; a `headless` origin without a parent stays adoptable.

## Alternatives considered

**Keep one origin and encode the run kind in events.** The header origin is the existing machine-readable creation field; a parallel event would duplicate it and leave every pre-headless consumer reading the narrower field.

**Admit any string origin.** Open-ended values make every consumer's equality test silently miss new values. The closed two-value union keeps the miss loud at the format boundary.

## Consequences

Logs written by a v4 writer are refused by older builds as an unsupported format until those builds ship this edge; that is the standard publication cost recorded by the [version mechanism](2026-08-10-session-log-version-mechanism.md). Sessions created before this change keep an absent origin and remain indistinguishable from human-created Sessions forever — the widening is not a backfill. The release record in [session-format-status](../../../../docs/session-format-status.md) still names v3 until a product release publishes v4.
