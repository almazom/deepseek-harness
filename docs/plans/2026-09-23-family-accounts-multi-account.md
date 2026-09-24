# Family Accounts (Multi-Account dsh web) Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add passwordless family accounts (timur, darya, lili + operator) to the existing dsh web app, with mandatory isolation of dsh web profile/session state AND OpenViking user scopes.

**Architecture:** Gateway-guardian model — the browser holds only our session cookies (access 15 min + refresh 30 days rolling); OpenViking API keys stay server-side and every OV call runs with the owning user's identity. Entry factor is a one-time email letter (magic link + 6-digit backup code, 10-min TTL); "restore access" is the same letter flow. Spec: `docs/superpowers/specs/2026-09-23-family-accounts-design.md` (commit c509edf989). Decision record: `viking://resources/projects/dsh/decisions/DEC-2026-09-23-family-accounts-passwordless.md`. Review findings folded into the tasks below (3 optics + external deep-dive, 2026-09-24): `viking://resources/projects/dsh/reviews/2026-09-24-family-accounts-plan-enrichment/`.

**Tech Stack:** TypeScript ESM strict (repo conventions in AGENTS.md), Node ^22, `node:crypto` scrypt for one-time secrets (zero new deps), JSON account store (4 accounts — YAGNI), SMTP letter transport behind a Config-typed seam (console transport for dev/tests).

---

## Task 1: Confirm entry-chain placement (decision + recon)

**Objective:** Decide where the family door sits relative to the existing public chain: Caddy (pets VPS) → tailnet-auth-proxy :3082 (tailnet membership + shared token, HttpOnly cookie TTL 30 days) → 127.0.0.1:3080 dsh web.

**Steps:**
1. Run the four-layer probe from `dsh-doctor` and record which layer blocks a non-tailnet device.
2. Choose (record the choice in this file's header):
   - **Option A (recommended, YAGNI):** family devices join the tailnet (one-time setup on their phones); the gate stays unchanged; account login lives entirely in the app layer.
   - **Option B:** extend the gate with a public family door — only if family must log in from devices outside the tailnet (risk: DoS, credential stuffing, probing of dev-preview APIs).
3. Resolve the gate token question for Option A: `tailnet-auth-proxy :3082` admits tailnet membership AND a shared token cookie (TTL 30 days) — decide whether family devices get the shared token cookie or tailnet identity alone, and who provisions/rotates the token.
4. Verify the app-layer seams by reading: `packages/api/gateway/`, `packages/api/workspace-controller/src/`, `packages/credentials/authorization/src/`, `packages/session/session-persistence/src/`, `packages/settings/settings-file/src/`, `packages/identity/anonymous-user-id/src/`, `packages/client/web/`, `packages/client/connection/src/loopback-hostname.ts`.
5. Name the HTTP entry seam owning `Set-Cookie`/clear-cookie, magic-link GET pages, and all pre-session routes: `packages/api/gateway/src/stream-server.ts` + `stream-protocol.ts` are a typert RPC stream server with NO HTTP route registry, so cookie lifecycle and HTML pages live elsewhere. Record the seam in this file's header; account-controller RPC carries payloads only.
6. Attempt a real login over the chosen chain's real URL scheme and record cookie behavior: `Secure` cookies are silently dropped over a plain-HTTP path, and the `fam_access`/`fam_refresh` scheme depends on this.
7. Check `loopback-hostname.ts` behavior on the tailnet hostname: it classifies non-loopback origins as non-local and silently disables persistent settings (volatile-memory fallback). Fix via reverse-proxy header rewrites or a heuristic accepting the tailnet domain.

**Verify:** header of this file names the chosen option and the HTTP entry seam; seam list is annotated with the real entry points found; cookie behavior on the real URL scheme is recorded.

## Task 2: account-registry package — store and lookup

**Objective:** Own the mapping account ↔ email ↔ OpenViking (account_id, user_id) ↔ dsh profile id.

**Files:**
- Create: `packages/account/account/` (`@deepseek-ai/dsh-account`): `src/index.ts`, `src/store.ts`, `src/config.ts`, `tests/store.host.spec.ts`, `README.md`, `package.json` — ONE package owns registry + one-time secrets + policy + sessions + audit (Tasks 3–5 and 11 add modules here; five packages for four users is over-split). `account-ov-adapter` and `account-controller` stay separate.

**Step 1: Write failing test** — create account `timur` with email; `getByEmail("timur@example.com")` returns it (case-insensitive email); unknown email returns `null`; duplicate email rejected.

**Step 2: Run test, expect FAIL** (module missing): `pnpm run test` filtered to `store.host.spec`.

**Step 3: Implement minimal store** — JSON file at Config `storePath` (default under `~/.dsh/family/accounts.json`), written with mode `0600`, atomic rename via `packages/util/atomic-write` plus an in-process write lock (concurrent writes must not corrupt; restart-mid-flow behavior defined). Record shape:

```ts
interface AccountRecord {
  schemaVersion: 1
  accountId: AccountId       // branded lowercase slug owner-chosen (e.g. "timur"); slug charset allowlist before any path join
  email: string              // normalized lowercase
  displayName: string
  status: "pending" | "active" | "rebind-pending" | "disabled" // "pending" until first successful letter login to this address
  ov: { accountId: OvAccountId; userId: OvUserId } // OV identity the ov-adapter uses (branded)
  dshProfileId: DshProfileId // owner of dsh web sessions/settings/todos (branded)
  createdAt: string          // ISO 8601
}
```

**Step 4: Config owner** — one validated Config type in `src/config.ts` owns every tunable (storePath, auditPath, letter caps, alive-code cap, access/refresh TTLs; AGENTS.md bans hardcoded tunables). Security invariants stay fixed in code, not Config: one-time-ness, 10-min secret TTL, constant-time compare. Brand ids via `Branded<B>` (`dsh-brand`).

**Step 5: Run test, expect PASS. Step 6: Commit** — `feat(account): account store with email lookup`.

## Task 3: one-time login codes (TDD)

**Objective:** 6-digit codes and magic-link tokens, one-time, 10-minute TTL, stored hashed.

**Files:**
- Add: `packages/account/account/src/secrets.ts`, `tests/secrets.host.spec.ts` (module of the Task 2 package)

**Step 1: Failing tests** — issue() returns a plaintext code and stores only a hash; verify() accepts once, rejects second use; verify() rejects after 10 minutes; verify() rejects wrong code; five wrong guesses burn the code and increment a per-account counter; secrets and counters survive a process restart (disk-backed store, atomic rename + write lock); a GET on a magic link renders a confirm page WITHOUT consuming the token (mail-scanner/SafeLinks prefetch) and only the follow-up POST consumes it.

**Step 2: Run, expect FAIL.**

**Step 3: Implement** with `node:crypto` `scryptSync` + random 16-byte salt per secret; constant-time compare (`timingSafeEqual`); persist secrets/counters through `packages/util/atomic-write` (the external review's "dsh-atomic-write"):

```ts
const TTL_MS = 10 * 60 * 1000;
// code: 6 digits via randomInt(0, 1_000_000).padStart(6, "0")
// link token: randomBytes(32).toString("hex")
```

**Step 4: Run, expect PASS. Step 5: Commit** — `feat(account): one-time hashed login codes and link tokens`.

## Task 4: letter request policy (TDD)

**Objective:** Neutral responses and letter rate limiting.

**Files:**
- Modify: `packages/account/account-auth/src/secrets.ts` (or new `policy.ts`), `tests/policy.host.spec.ts`

**Step 1: Failing tests** — unknown email and known email produce the identical response object (envelope AND timing); more than 3 letters per email per 15 min are refused with the same neutral response; at most 5 unverified codes alive per account; more than 5 wrong guesses on one code burns it; per-account and per-IP rate limits on `account/verify`; per-IP and global caps on `account/request-login` (per-email alone still allows mail-bombing the four mailboxes via the SMTP relay).

**Step 2: FAIL → Step 3: implement counters in the auth store (all limits read from the Task 2 Config). Step 4: PASS. Step 5: Commit.**

## Task 5: sessions — access + rolling refresh (TDD)

**Objective:** Cookie model: access 15 min auto-renewed on use, refresh 30 days rolling, replay-safe, logout kills both.

**Files:**
- Add: `packages/account/account/src/session.ts`, `tests/session.host.spec.ts`

**Step 1: Failing tests** — login creates session; access cookie renews `expiresAt` on use; refresh rotates the token and the old one is rejected; replay of the PREVIOUS refresh revokes the whole session — except within an accept-grace window (~10 s) where presenting `prevRefreshHash` re-issues the CURRENT tokens (mobile packet-loss retry); concurrent two-tab and two-device refresh both succeed (single-flight mutex around refresh — benign double refresh must not log the family member out); verify/link always MINTS a fresh session id and overwrites (never adopts) pre-existing `fam_access`/`fam_refresh` (anti-fixation); logout deletes both; refresh past 30 days fails; operator kill-sessions-for-account revokes every session of one account.

**Step 2: FAIL → Step 3: implement** session record `{ sessionId, accountId, accessHash, refreshHash, prevRefreshHash, accessExpiresAt, refreshExpiresAt, lastUsedAt, device }`; cookies `fam_access` / `fam_refresh` are `HttpOnly; Secure; SameSite=Lax` opaque ids (`Secure` feasibility = the real-URL probe in Task 1 step 6). **Step 4: PASS. Step 5: Commit.**

## Task 6: mail transport seam

**Objective:** Send the login letter (button link + 6-digit code) through a Config-typed transport.

**Files:**
- Create: `packages/account/account-mail/` (`@deepseek-ai/dsh-account-mail`): `src/index.ts` (Service Definition + `smtp` and `console` providers), `tests/mail.host.spec.ts`, `README.md`

**Steps:** failing test renders the letter with link + code and calls the transport; implement `console` provider (dev) and `smtp` provider (Config: host/port/user/pass/from — read from `packages/credentials/credentials-local`, never hardcoded); failure-atomicity tests: a failed send must not burn the 5-alive-code budget or leave dead secrets, and the response envelope + timing stay identical to the neutral response; PASS; commit `feat(account-mail): login letter transport seam`.

## Task 7: ov-adapter — server-side OV identity

**Objective:** Every OpenViking call runs with the owning user's identity; OV keys never reach a client.

**Files:**
- Create: `packages/account/account-ov-adapter/src/index.ts` + tests
- Integrate: `packages/credentials/credentials-local/` for OV key storage (Config path, `0600`)

**Steps:** failing test — given `dshProfileId`, the adapter resolves the account and issues OV requests as `ov.userId`; target identity derives SOLELY from the validated session and client-supplied tenant headers are stripped at the gateway; keys are not exposed in any API response; every plugin→OV call goes through the adapter with per-tenant `ov.accountId`/`ov.userId` injection — memory plugins (`@openviking/dsh-memory-plugin` / `@deepseek-ai/dsh-memory-openviking`) default to a static API key in cordis.yml and would merge all family memories into one graph; PASS; commit.

## Task 8: API endpoints (account-controller)

**Objective:** Wire auth to the RPC gateway: `account/request-login`, `account/verify` (code or link), `account/refresh`, `account/logout`, `admin/rebind-email` (operator-only).

**Files:**
- Create: `packages/api/account-controller/` (`@deepseek-ai/dsh-account-controller`): `src/index.ts`, `src/routes.ts`, `tests/account-controller.host.spec.ts`
- Modify: the HTTP entry seam named in Task 1 (owns Set-Cookie/clear-cookie + magic-link GET + pre-session routes; `packages/api/gateway/src/stream-server.ts` is a typert RPC stream server with no HTTP route registry — account-controller RPC carries payloads only)

**Steps:** failing route tests (request-login always returns the neutral envelope; verify sets cookies AND always mints a fresh session id overwriting any planted cookies; magic-link GET renders a "confirm login" page and only the follow-up POST consumes the token; refresh rotates; logout clears; rebind-email requires operator role); implement; PASS; commit.

## Task 9: login screens (client)

**Objective:** Progressive-HTML screens inside dsh web: enter email → "check your mailbox" → enter backup code → inside; "I cannot log in" resends the letter.

**Files:**
- Create: `packages/client/ui-login/` (`@deepseek-ai/dsh-ui-login`): `src/`, `src/locales.ts` (ALL product copy goes through the locale dictionary — `verify-client-ui-i18n` rejects hardcoded copy)
- Modify: `packages/client/ui-slots/` + `packages/client/web/` slot registration (exact slot file from Task 1 recon)

**Steps:** implement screens against the Task 8 endpoints; add locale entries EN+RU (`verify-client-ui-i18n` rejects hardcoded strings); failure-path screens: expired-link page with resend, resend countdown, spam-folder hint, child-proof code entry (autofill + digit fields); the screens render in the bare `packages/client/web` shell without triggering unauthorized RPC; test the mail-transport-failure path; commit `feat(ui-login): passwordless family login screens`.

## Task 10: dsh web state isolation (the "!!!!" requirement)

**Objective:** Chats, sessions, todos, settings, presets carry an owner and are filtered by it; one account can never list or open another account's state.

**Files:**
- Create: `packages/session/session-format-vN-to-vN+1/` versioned migration package (pattern: `packages/session/session-format-v2-to-v3`) + bump `SESSION_FORMAT_VERSION` + refresh TS/Python SDK expected outputs (AGENTS.md adjacent-migration rule freezes committed generations)
- Modify: `packages/session/session-persistence/src/storage-contract.ts` (owner stamp on write, owner filter on read — single enforcement point so the WIP session/workspace controllers consume already-scoped queries), `packages/session/session-projection/src/` (cache cells keyed `<dshProfileId>:<sessionId>`, owner-checked snapshots)
- Modify: `packages/settings/settings-file/src/` (per-profile settings path `~/.dsh/family/<dshProfileId>/settings.yaml`)
- Modify: `packages/api/workspace-controller/src/` and `packages/api/session-controller/src/` (owner-scoped queries — session-controller is currently WIP in this tree; coordinate with that work; fail closed `workspace/not-found`)
- Test: `packages/api/session-controller/tests/cross-account.host.spec.ts`

**Steps:** failing cross-account probe tests (account A cannot see B's sessions/todos/settings, via both list and direct id, and via projection/search/aggregate reads — session titles, todos queries, settings reads); implement owner scoping at the persistence layer (filter on read, stamp on write); partition data by profile — `JsonlSessionPersistence.root` → `$DSH_HOME/profiles/<dshProfileId>/sessions/`; allowlist `accountId`/`dshProfileId` slug charset before any filesystem path join; PASS; commit `feat(session): owner-scoped dsh web state isolation`.

## Task 11: admin plan-B surface + audit log

**Objective:** Operator can rebind a lost mailbox; every entry attempt lands in an operator-visible audit log.

**Files:**
- Add: `packages/account/account/src/audit.ts` (append-only JSONL at Config `auditPath`; single package per Task 2)
- Modify: `packages/api/account-controller/src/routes.ts` (rebind-email + audit reads)

**Steps:** failing tests (rebind sends a fresh letter to the new address and invalidates old login codes AND revokes ALL live sessions and outstanding codes — assert in tests; account status flips pending→active only on first successful letter login to that exact address, rebind → `rebind-pending` until confirmed from the new address; the rebind UI shows the full new address; unknown-email response unchanged; audit records success and failure attempts with timestamp + account + client IP + user agent, storing outcome + hashed secret id only — never plaintext codes/links/cookies — with a per-line prev-hash chain); implement; PASS; commit.

## Task 12: acceptance pass + docs

**Objective:** Prove the spec's acceptance criteria; satisfy repo documentation rules.

**Steps:**
1. Cross-account acceptance suite green (Task 10 tests + link/code one-time + expiry + logout + rotation-replay + OV cross-account probes: account A cannot reach user/B scope through the ov-adapter — search, direct read, session write).
2. Real-URL login over the chosen chain: cookie persistence recorded (Task 1 step 6).
3. Snapshot: add a keyless recorded-session snapshot for the login flow output (repo testing policy).
4. Docs: package READMEs + `docs/` touch-points; **Agent Note in the same PR** (repo rule for non-trivial changes); run `pnpm run doc-sync`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`.
5. Report done.

## Out of scope (own spec → plan cycles later)

- **S2** mail production hardening (SPF/DKIM, templates, new-entry notifications).
- **S3** OV provisioning model (one family account with users vs account per member; explicit family scope for shared content).
- **S4** personalization (per-account persona — `packages/preset/persona/` is the seam — voice, avatar, theme).
