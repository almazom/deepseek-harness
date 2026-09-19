# Agent Note: Headless session origin

Status: implemented

English | [中文](2026-09-17-headless-session-origin.zh.md)

## Problem

The GUI session list cannot tell a session the operator opened from a session the one-shot headless runner created. Headless runs appear as ordinary rows, so an operator who scripts `dsh --profile headless` cannot see which rows are machine-generated and cannot hide them.

## Decision

The headless runner stamps every session it creates with the durable header origin `headless`, admitted by the released v4 format edge described in the [released session-format migrations note](2026-08-31-released-session-format-migrations.md). Origin stays session data: it is written once at creation, survives in the log, and every consumer that must treat subagent sessions specially continues to test for `subagent` only.

The workspace browser keeps origin-based visibility under user control. A View-options **Show** entry selects `all` (default), `human` (hides headless-created rows), or `headless` (hides human-created rows), and the filter applies to grouped sections, the flat list and search alike, because a filter that hides a row from one list must hide it from every list. A visible headless-created row carries a localized badge. An absent origin still means human-created, so every pre-existing session keeps its current visibility without migration.

## Alternatives considered

**Prefix titles with "Headless:".** The stored title is user-renamable data; a marker the user can delete, and that rename dialogs and title-inheritance would preserve or mangle, is not an identity. Prefixes would also have to be repeated for every future machine origin.

**Infer origin on the client.** Absence of evidence cannot distinguish a headless session from an old human session, so the browser would both miss rows and misclassify; the writer is the only component that knows the truth at creation.

## Consequences

Older builds refuse logs written by this change as unknown format v4 until they ship the v4 edge; that is the standard publication cost of a session-format bump. The filter is browser view state (persist key bumped to `dsh.workspace.view.v6`), not shared settings, so each browser remembers its own choice. Headless sessions remain directly adoptable by the runner: origin `headless` does not inherit the subagent refusal.
