# Family Accounts — Multi-Account dsh Web (Design)

**Status:** approved by operator 2026-09-23 (brainstorming session) · covers sub-project S1; S2–S4 follow their own spec → plan → build cycles.

## Purpose

Family members (timur, darya, lili) log into the same dsh web app the operator uses, without passwords, and each gets a strictly isolated account: own dsh web profile and sessions plus own OpenViking user scope. Recovery works the way big-IT users expect: a "restore access" button that sends email. Verified by: family members enter and recover access unaided, and no account can reach another account's sessions, memory, or settings.

## Decisions (confirmed by operator)

- **Same app, no new product.** Multi-account is added inside the existing dsh web (close-reading.ru/dsh). No separate login application.
- **Web only, progressive HTML.** No messenger bots in scope.
- **No passwords at all.** Entry factor: email letter with a magic login button plus a 6-digit backup code. Both one-time, 10-minute TTL. "Restore access" is the same flow — there is no password to reset.
- **Sessions:** access cookie 15 min, auto-renewed on use; refresh cookie 30 days, rolling. Logout kills both immediately.
- **Recovery plan B:** if a member loses their mailbox, the operator rebinds a new email from the admin surface (operator is ROOT of the system).
- **Approach A "gateway-guardian":** the browser only ever holds our session cookies; OpenViking API keys stay server-side and are never sent to a client.
- **Isolation is mandatory at BOTH layers:** dsh web profile/session state AND OpenViking user scope. Each account's chats, session history, todos, settings, and presets are unreachable cross-account.

## Architecture

```
📱💻 browser → close-reading.ru/dsh (the existing dsh web, progressive UI)
      │
      ├─ 🚪 family login screen (new): email → letter (link + code) → inside
      │     cookies: access 15 min (auto-renew) + refresh 30 days (rolling)
      │
      ├─ 👤 account = profile inside dsh web
      │     own chats · own sessions · own settings · own persona (S4)
      │
      └─ 🔑 ov-adapter (server-side): one OpenViking key per user, stored as a secret
                │
                ▼
      🗄️ OpenViking: user/timur · user/darya · user/lili — isolated memory scopes
```

Components:

- **family-login** — dsh web screens: enter email, enter backup code, "I cannot log in", logged-in landing.
- **auth-core** — issues and verifies login links/codes, owns the session/token store, letter rate limiting, and the entry audit log.
- **account registry** — maps account ↔ email ↔ OpenViking (account_id, user_id) ↔ dsh web profile id.
- **ov-adapter** — server-side OpenViking credentials per user; every OpenViking call runs with that user's identity, never the operator's.
- **mail-sender** — sends login letters. S1 ships it as a minimal SMTP sender; production hardening is S2.

## Isolation rules

1. One login session = exactly one account. No in-app account switching; changing accounts means logout + fresh login.
2. dsh web profile and session state are isolated per account: chat history, sessions, todos, settings, presets all carry their owner and are filtered by it.
3. OpenViking memory is isolated per user (`user/<id>/` scopes). Shared family content only through an explicit family scope (defined in S3).
4. OpenViking keys never reach the browser; cookies carry opaque session ids only.
5. The operator's existing admin door (tailnet token flow) stays untouched as the operator-only entrance.
6. The entry audit log (who entered, when, from which device) is visible to the operator only.

## Flows

**Entry.** Open dsh web → "Log in" → type your email → letter arrives with a login button and a 6-digit code → click the link (or type the code on the device where you need it) → you are inside. Each link/code is one-time, valid 10 minutes.

**Recovery.** "I cannot log in" on the login screen sends a fresh letter. Same procedure as entry; nothing to reset.

**Plan B.** Member lost their mailbox → operator clicks "restore access for X", binds a new email → fresh letter to the new address.

## Error handling

- Expired or reused link/code → "request a new one"; no broken states.
- Unknown email → the same neutral answer ("check your mailbox"); never reveals whether an account exists.
- Letter rate limit per email address to prevent mailbox flooding.
- Every entry attempt (success or failure) lands in the audit log.

## Acceptance / testing

- timur, darya, and lili each enter and recover access without operator help.
- Cross-account probes fail: one account cannot list or open another account's dsh sessions, todos, settings, or OpenViking memory.
- Link and code are one-time and expire after 10 minutes (unit + flow tests).
- Logout kills both cookies; refresh rotation works and replay of a rotated refresh is rejected.
- Unknown-email responses are indistinguishable from known-email responses.

## Out of scope (next sub-projects)

- **S2 mail-sender production:** SMTP deliverability, templates, notifications of new entries.
- **S3 OpenViking provisioning:** one family account with several users vs an account per member; explicit family scope for shared content; key lifecycle.
- **S4 personalization:** per-account persona (name, voice, avatar), theme, tailored UI.
