---
description: "Released-v3 Session codec with the identity conversion into v4 and the widened header origin."
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v3-to-v4

English | [中文](README.zh.md)

## Summary

This package restores released v3 Session JSONL as v4 and writes v4 with the exact released-v3 row semantics. The conversion is an identity: every event, sequence position, surface operation, and source reference passes through unchanged, and only the header version moves from 3 to 4. Version 4 opens the header `origin` field to the headless value alongside the released-v3 `"subagent"` value; no other header field, event type, or payload member changes. Malformed rows, unknown origins, and unsupported relationships refuse before the current restorer runs, with the source retained for recovery.

## Table of Contents

- [Use this package](#use-this-package)
- [V3-to-V4 specification](#v3-to-v4-specification)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Persistence obtains this edge through `dsh-session-format-catalog`; feature compositions do not mount it. Import it directly only when assembling or testing the static released-format catalog. No runtime invariant companion is published because the package has no independently observable runtime registrations whose state can diverge; decoder and migration-stage state belongs to one restore.

### Entry point

```text
const decoder = releasedV4SessionFormatCodec.createDecoder(physicalHeader, 'recoverable')
for (const row of physicalRows) decoder.decodeRow(row, migrationContext)
const inheritedEventCount = decoder.finish(migrationContext)
const stage = sessionFormatV3ToV4.createStage(stageInput)
stage.transformEvent(event, migrationContext)
const targetInheritedEventCount = stage.finish(migrationContext)
```

`releasedV4SessionFormatCodec` reads the exact v4 header — a v3 header with the widened `origin` — and delegates row framing to the frozen released-v3 codec. `sessionFormatV3ToV4` creates one stateful stage per restore; the static catalog connects that decoder and stage so migration does not retain a physical-row array. `assertReleasedV4Header` and `restoreReleasedV4Artifact` provide the target admission used by the catalog.

-----

<a id="v3-to-v4-specification"></a>
## V3-to-V4 specification

- **Header** — `migrateHeader()` accepts an exact released-v3 header and returns the same fields with `version: 4`. The `origin` field carries its released-v3 value through; writers of v4 may set `origin` to `"headless"`, and the target validator accepts `"subagent"`, `"headless"`, and absence equally.
- **Events** — the stage re-emits every event with its original sequence, time, data, surface operation, and source references. Dense v3 sequences stay dense v3 sequences, so no local reference is remapped.
- **Inheritance** — the last `session/end-seed` marker carrying `data.inherited: true` identifies the inherited cut, which keeps its source sequence position. Unseeded sources must not contain the marker and must produce a zero cut.
- **Delivery markers** — a `session-log-deepseek/delivery-accepted` marker claiming format v4 refuses, and a v3 marker naming a different Session and sitting in the current generation refuses, exactly as the released-v3 edge enforced.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The codec owns v4 physical-header admission and borrows the frozen released-v3 validators for every other field and for row semantics; released validators cannot drift, so the borrowed behavior is deterministic. The migration stage tracks density, the inherited cut, and foreign delivery markers, and emits each source event unchanged.

| File | Role |
|---|---|
| [`src/codec.ts`](src/codec.ts) | Frozen v4 physical header and row delegation |
| [`src/migration.ts`](src/migration.ts) | Identity edge and cut bookkeeping |
| [`src/validation.ts`](src/validation.ts) | Exact target validation and artifact restore |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Migration machinery](../session-format/README.md) — pure chain and codec contracts.
- [Static catalog](../session-format-catalog/README.md) — build-owned assembly.
- [Session subsystem](../../../docs/subsystems/session.md) — current logical Session semantics.

-----

<a id="model-experience"></a>
## Model Experience

### Historical restoration

#### What the model sees

Nothing directly. After restoration, `deriveMessages()` sees canonical released-v3 events unchanged under v4.

#### Token effect

Zero direct tokens.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Closed v3 source admission** — v3 sources keep the released-v3 `origin` vocabulary; the headless value is writable only in v4.
- **One adjacent edge** — this package does not perform publication or select later migrations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
