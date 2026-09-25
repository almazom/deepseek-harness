---
description: "Outbound mail for DeepSeek Harness: one Config-selected seam (console or SMTP), guarded letters, and CLI plus MCP entry points an agent can call."
kind: "package-library"
---

# @deepseek-ai/dsh-mail

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-mail` gives the harness one way to send mail. A caller describes a letter; the seam validates recipients and identity, applies the guard stack (rate limits, send log, audit chain), serializes MIME with a text and optional HTML part, and hands the result to a transport. The transport comes from configuration alone — `console` by default, which prints the letter and sends nothing, and `smtp`, which submits it to a relay using credentials from the harness credential store. The same call is therefore safe on a laptop and real on the family server.

State lives under `$DSH_HOME/mail/` (`$DSH_HOME` defaults to `~/.dsh`): `send-log.jsonl` (hashed recipients, no bodies), `rate-state.json`, `audit.log` (hash-chained), and `recipient-salt`. The package exposes a CLI (`mail-send`, `mail-preview`, `mail-status`, `mail-accept`), an MCP server (`mail-mcp`) with four tools, and a library API for other packages.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Reach for this package when something in the harness needs to send mail: a magic-link letter, a nightly report, an acceptance probe. Send through the seam instead of talking SMTP yourself, because the seam is where identity, policy, rate limits, and audit live — a second send path would bypass all four.

### Sending from an agent

Register the MCP server, then call its tools. The server speaks JSON-RPC over stdio and exposes `send_email`, `send_batch` (up to 50 letters), `render_template`, and `delivery_status`; every tool call goes through the same seam, so limits and audit apply to model-driven sends too.

```bash
mail-mcp            # stdio MCP server; register it in the harness MCP config
```

### Sending from a shell

```bash
mail-send --to someone@example.com --subject "Nightly report" --body-file report.txt --json
mail-send --template invite --locale ru --var name=Тимур --var link=https://example.test/i/1 --var expiresMinutes=10 --to timur@example.com
mail-preview --template invite --locale ru --out /tmp/invite-ru.html --style
mail-status --json
mail-accept --dry-run
```

Exit codes are part of the contract: `0` sent (or dry run accepted), `2` refused — the JSON error says why — and `3` usage. A refusal is data, never a crash: `mail-send` prints `{"ok":false,"error":{"code":...}}` and exits 2.

### Configuration

Every knob is an environment variable read by `resolveConfig`: `MSH_TRANSPORT` (`console` or `smtp`), `MSH_FROM`, `MSH_IDENTITIES`, `MSH_CREDENTIALS`, `MSH_LOG`, `MSH_STATE`, `MSH_DATA_DIR`, `MSH_ALLOW`, `MSH_DENY`, `MSH_MAX_PER_DAY`, `MSH_MAX_PER_HOUR`, and the attachment caps `MSH_MAX_ATTACHMENTS`, `MSH_MAX_ATTACHMENT_BYTES`, `MSH_MAX_ATTACHMENT_TOTAL_BYTES`. SMTP credentials come from `$DSH_HOME/.credentials.yaml` (mode 0600) as record `smtp/mail-relay`, or from `MSH_SMTP_HOST`/`MSH_SMTP_PORT`/`MSH_SMTP_USER`/`MSH_SMTP_PASS` for a one-off run.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The seam is one function. `createMailer(config, options)` returns a `Mailer` whose `send(request)` runs five steps in order: assemble (`assembleLetter` — recipient shape, sender identity against the roster, subject shape, reserved headers, attachment caps, recipient policy), guard (`beforeSend` on each guard, so a rate limit refuses before anything else happens), serialize (`renderLetter` — RFC 2047 headers, multipart/alternative, multipart/mixed with attachments, `Message-ID`), transport (`ConsoleTransport` prints; `SmtpTransport` opens `node:net`/`node:tls` and speaks ESMTP with implicit TLS on 465, STARTTLS otherwise, AUTH LOGIN with a PLAIN fallback), and after-hooks (`afterSend` on each guard writes the log row and the audit entry). A failure short-circuits to a structured `SendFailure` and the guards still see it through `onRefusal`.

The guard stack is fixed and shared by both host entry points: `RateLimiter` (rolling windows — per minute, hour, day, per recipient per day, first-contact per hour, bulk recipient cap; windows never reset, so a backwards clock cannot open a free window), `SendLog` (JSONL rows with hashed recipients, rotation at 5 MiB or 30 days, a failure alerter with a dedup window, and DMARC report parsing), and `AuditLog` (a hash chain over `sha256(prev + canonicalJson(payload))` that `verifyAuditChain` can re-walk).

Templates live in `templates.ts` as data: four ids (`invite`, `access-recovery`, `nightly-report`, `test-letter`), each with `ru` and `en` and identical placeholder sets. `verifyTemplateParity` fails on a missing locale, a missing or stray key, an untranslated body, or an empty body, and `generateMailI18nReport` prints the `PASS`/`FAIL` line the `verify-i18n-mail` gate consumes. HTML letters inline every style; a `<style>` block appears only for local previews, so a sent letter has zero `<style>` tags and a text part generated from the same template.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Run `mail-accept` for the built-in acceptance table: it exercises template parity, HTML inlining, console send, identity spoofing, policy, rate limits, attachment guards, log rows, audit chain, the MCP tool surface, a scripted SMTP conversation, and dry-run purity, then prints one PASS/FAIL line per check.

<a id="model-experience"></a>
## Model Experience

#### What the model sees

When the `mail-mcp` server is registered, the model sees four tools with JSON schemas: `send_email`, `send_batch`, `render_template`, and `delivery_status`. A refused send comes back as tool output, not a transport error, so the model reads `{"ok":false,"error":{"code":"rate_limited","scope":"per-hour","retryAfterSeconds":900}}` and can explain or wait. The model never sees SMTP credentials; the seam resolves them server-side.

#### Token effect

The tool surface is a fixed cost paid once per session that registers the server: four tool definitions with their schemas, roughly 600 tokens. Individual calls add only the arguments they send — a subject and a body — and refusals add a short structured error. Nothing about the mail transport streams into context.

#### KV Cache effect

The tool definitions are static, so they sit in the cached prompt prefix and do not invalidate it between turns. Sending mail does not append model-visible history beyond the caller's own tool call and its result, and the package injects no per-send context of its own.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The outbound path is one-way. Inbound mail, IMAP polling for bounce messages, and mailbox reading are out of scope; bounces enter the log through `recordBounce` or the DMARC report directory.
- The shipped relay configuration is variant A: an existing external relay, so the `From` identity is limited to that provider's mailbox. Sending from a harness-owned domain needs variant B (an own MTA with SPF, DKIM, DMARC, and PTR) and is tracked separately.
- `rate-state.json` assumes a single writer process. Two processes sending at once can lose a count; the file has no lock.
- The send log hides recipients behind a salted hash by default; `exposeAddresses` opts out for a local, 0600-only log. Nothing re-identifies a hashed recipient, by design.
- DMARC digest covers aggregate XML reports you point it at. It does not fetch reports from the `rua` mailbox itself, and no external provider is contacted while testing.
- The package has no dependency on the harness runtime and is not wired as a host service yet: MCP registration and the nightly-report caller are operator tasks.

<a id="dev-note"></a>
## Dev Note

```bash
pnpm --filter @deepseek-ai/dsh-mail test          # vitest: 11 spec files, one per capability
pnpm run verify-i18n-mail                         # template parity gate
./node_modules/.bin/tsx packages/mail/mail/src/cli.ts accept   # acceptance table
```

Transports are injectable (`createMailer(config, {transports, dialer})`), which is how the SMTP tests run a real ESMTP conversation against a local `node:net` peer without a network.
