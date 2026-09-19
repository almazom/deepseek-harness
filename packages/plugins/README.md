---
description: "The plugins group map: isolated self-contained product plugins that own one whole product surface between the user and the system and mount or omit as a unit."
kind: "package-group"
---

# packages/plugins

English | [中文](README.zh.md)

## Summary

The plugins group holds isolated, self-contained product plugins: each package owns one whole product surface — its service, its human command, and its projections — so a deployment mounts or omits the unit without scattering that surface across core groups. Packages here may consume optional core services but never extend them; the group boundary is the isolation contract this page maps, and each package README owns its per-package contract.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`smart_steer`](smart_steer/README.md) | The Smart-steer advisory surface: the model-backed `queueAdvisor` dispatcher, the `/side` (`/btw`) command, and the `advisor/run` + `smart_steer/latest-human` projections | `ctx.queueAdvisor` (optional), registers on `ctx.commands` |

<a id="related-documentation"></a>
## Related documentation

- [Smart-steer plugin](smart_steer/README.md) — mount rows, command reference, and the advisory run contract.
- [Session subsystem](../session/README.md) — the session data plane whose event log and projection registry this group builds on.
- [Profile bundles](../bundle/README.md) — the patch layers that mount these plugins into shipped profiles.

<a id="dev-note"></a>
## Dev Note

None.
