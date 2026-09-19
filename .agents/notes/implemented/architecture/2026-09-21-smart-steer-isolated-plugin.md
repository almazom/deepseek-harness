# Agent Note: the Smart-steer surface isolates into the smart_steer plugin

Status: implemented

English | [中文](2026-09-21-smart-steer-isolated-plugin.zh.md)

- Kind: architecture
- Scope: packages/plugins/smart_steer, packages/session, packages/api/session-controller, packages/client/ui-conversation, packages/bundle, packages/preset
- Date: 2026-09-21
- Supersedes (structural): the two-package layout of [the empty-queue fallback note](../feature/2026-09-21-command-side-empty-queue-fallback-latest-human-message.md), whose behavior contracts carry over unchanged into the merged package

## Problem

The Smart-steer surface lived across two `packages/session/` packages — the `session-advisor-llm` dispatcher and the `command-side` command — with the seam between them expressed as cross-package imports and five separate mount rows. The surface is one product unit between the user and the system: the same deployment decision (does this deployment advise side questions?) governs both packages, yet mounting them meant keeping two plugin ids, two dependency rows, and a name-pair (`@deepseek-ai/dsh-session-advisor-llm`, `@deepseek-ai/dsh-command-side`) that named an implementation detail instead of the product. The group placement also overstated their role: neither package is session data plane; they consume it.

## Decision

One isolated plugin replaces both: `packages/plugins/smart_steer/`, npm `@deepseek-ai/dsh-smart-steer`, cordis plugin name `smart_steer`. The package owns the dispatcher service (`./dispatcher` subpath, default-exported `QueueAdvisorService`, unchanged), the `/side`/`/btw` command fragment, and both projection units — `advisor/run` unchanged, and the fallback projection renamed from `command-side/latest-human` to `smart_steer/latest-human` (key is package-owned, the feature is unreleased, and projection state refolds from the event log, so no committed generation moves). The root function plugin registers the command surface plus both projections, and constructs the dispatcher only when its mount config carries a paired provider/model: presets mount config-less and get the command surface, while the Web profile keeps mounting the `./dispatcher` entry as its `queue-advisor` host service — the topology that already worked, now spelled with one package name. The `session-controller` advise seam stays a strict `ctx.get('queueAdvisor')` lookup that degrades without the service; the plugin is optional to every consumer, including the client, whose advisor sheet types now import from the new specifier with no behavior change. The old packages are deleted (git mv preserves history), a `plugins/` group maps the new unit with a documented subsystem-page exemption, and the projection rename is recorded in the package README rather than a migration, because no released session format carried the old key.

## Alternatives considered

- One merged plugin entry everywhere (root plugin with config on the Web host plane too) — rejected for now: it would register the command surface on the host plane, where the shipped patch layer deliberately disables it because presets own the human command; collapsing the two mount entries belongs to a later topology pass.
- Keeping two packages under a new group — rejected: it would have preserved the cross-package import and the two-name seam, which is exactly the scatter the isolation removes.
- Keeping the `command-side/latest-human` key — rejected: the key is package-owned state, the feature shipped inside this same release cycle, and projection state rebuilds by folding the log, so the rename costs nothing and leaves no old-name residue in the isolated package.

## Consequences

- Consumers: `session-controller` and `ui-conversation` import types from `@deepseek-ai/dsh-smart-steer`; `session-controller`'s service lookup is unchanged and stays plugin-optional.
- Mounts: base bundle and the `ptc`/`standard`/`cordis` presets mount the root plugin (id `smart-steer`, config-less); the Web patch disables that id on the host plane and mounts `@deepseek-ai/dsh-smart-steer/dispatcher` as `queue-advisor` with explicit config.
- Tests: the five moved spec files run inside the package (46 tests), plus the consumer suites; the loader composition proof now boots the new package name.
- Deferred (superseded): the client advisor sheet and queue smart button later moved into this plugin through the client extension point — see [the client-half isolation note](2026-09-19-smart-steer-client-half-isolation.md).
