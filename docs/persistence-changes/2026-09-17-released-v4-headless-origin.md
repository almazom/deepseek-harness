---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-17-released-v4-headless-origin

English | [中文](2026-09-17-released-v4-headless-origin.zh.md)

## Summary

Opens the released v4 Session header origin to the `headless` value alongside `subagent`, and moves the writer to version 4.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-17-released-v4-headless-origin
baseline: false
changes:
  - root: "JsonlHeaderLine"
    previous: "2026-09-11-initial"
    after: "ccb0bfd91bb22e2254cf90d3e3ffc5b351e0bc7f1680cb9bea1cfa47fb30dbe3"
    decision: version-bump
  - root: "SessionHeader"
    previous: "2026-09-11-initial"
    after: "617b4fe6312ab550656095d55478dc1f42497d54ba0c3b52968c78aed539dabe"
    decision: version-bump
```

<a id="compatibility"></a>
## Compatibility

A released-format boundary change, so the acknowledgement decision is `version-bump`: logs written by the v4 writer are refused by older builds as unsupported until they ship the v3-to-v4 edge, and `sessionFormatVersionRefusal` gates direct scans of v3 logs the same way it gated predecessors. The only admitted values are `subagent` and `headless`; anything else still refuses at the header validators. Committed v3 generations are never rewritten in place — publication creates the versioned v4 successor beside them, and pre-headless sessions keep an absent origin with unchanged meaning.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/session/session-format packages/session/session-format-v3-to-v4 packages/session/session-format-catalog packages/session/session-persistence-jsonl packages/core/session packages/test-support/llm-replay: 2401 tests passed; pnpm run typecheck and pnpm run lint exit 0.

<a id="dev-note"></a>
## Dev Note

None.
