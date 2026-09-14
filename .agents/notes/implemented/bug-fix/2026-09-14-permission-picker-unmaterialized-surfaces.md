# Agent Note: Permission picker on unmaterialized surfaces

Status: implemented

English | [中文](2026-09-14-permission-picker-unmaterialized-surfaces.zh.md)

## Problem

The Web GUI's access-level chip and the `/permission` popup disagreed about availability. The chip renders from the session's `permissions` projection, which the composer draws for every session surface including New Session; the popup's decoration, however, required `sessions.binding(sessionId)?.session` — a materialized session face. On the New Session screen (and any other unmaterialized surface) the chip was visible and clickable while its popup silently did nothing: `options` threw `permission presets are not available on this host`, `onSelect` threw `this session is not materialized yet`, and `available` reported `false`, so the slash-command line simply missed. One control, two availability sources — the visible half lied about the clickable half.

## Decision

The picker has a second source: the host's permission settings namespace — the same descriptor the General settings row reads and writes. `available` is `true` when either the projection select or that namespace exists. `options` still prefers the projection; without a materialized session it awaits the settings mirror, reads the namespace's dynamic `defaultPreset` enum through `permissionDefaultOf`, and presents it with the same localized labels, active mark, and Full access risk gate as projection rows. `onSelect` still submits `/permission <preset>` for a materialized session; on an unmaterialized one it writes the pick as the new-session default through the controller's existing settings mutation — the current session is never touched. The plugin warms the settings mirror at apply (`controller.load()`), since the picker needs it before any settings page visit; a host whose describe fails keeps the picker on the projection path only, which is exactly the pre-change surface.

The `ghost`-session tests change meaning accordingly: options on a host without the namespace reject with the same host error as before, and an unmaterialized pick without a defaults row submits nothing. A new test drives an unmaterialized session against a served namespace and asserts the labeled rows, the active default, and the `settings/mutate` write.

## Alternatives considered

**Make the chip invisible on unmaterialized surfaces.** Hiding the composer chip would hide state the projection genuinely carries, and the New Session screen is precisely where setting a default before starting is useful. It also leaves the Settings-row write as the only pre-session control, one screen away.

**Extend the host `/permission` command to unmaterialized sessions.** The command writes a session's live permission policy; a session that does not exist has nothing to write. Serving the intent through the existing defaults write keeps the host command's contract intact and needs no host change at all.

## Consequences

The chip never dead-ends: every surface that renders it can open the picker, and a pick always lands somewhere well-defined — the live session when there is one, the new-session default when there is not. The cost is a second read path and a mirror warm-up per client boot; a permission-less host behaves exactly as before. The General settings row and the picker now share one namespace view, so their labels and option sets can only drift together, not apart.
