# Family Accounts (Multi-Account dsh web) Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add passwordless family accounts (timur, darya, lili + operator) to the existing dsh web app, with mandatory isolation of dsh web profile/session state AND OpenViking user scopes.

**Architecture:** Gateway-guardian model — the browser holds only our session cookies (access 15 min + refresh 30 days rolling); OpenViking API keys stay server-side and every OV call runs with the owning user's identity. Entry factor is a one-time email letter (magic link + 6-digit backup code, 10-min TTL); "restore access" is the same letter flow. Spec: `docs/superpowers/specs/2026-09-23-family-accounts-design.md` (commit c509edf989). Decision record: `viking://resources/projects/dsh/decisions/DEC-2026-09-23-family-accounts-passwordless.md`.

**Tech Stack:** TypeScript ESM strict (repo conventions in AGENTS.md), Node ^22, `node:crypto` scrypt for one-time secrets (zero new deps), JSON account store (4 accounts — YAGNI), SMTP letter transport behind a Config-typed seam (console transport for dev/tests).

---

## Task 1: Confirm entry-chain placement (decision + recon)

**Objective:** Decide where the family door sits relative to the existing public chain: Caddy (pets VPS) → tailnet-auth-proxy :3082 (tailnet membership + shared token, HttpOnly cookie TTL 30 days) → 127.0.0.1:3080 dsh web.

**Steps:**
1. Run the four-layer probe from `dsh-doctor` and record which layer blocks a non-tailnet device.
2. Choose (record the choice in this file's header):
   - **Option A (recommended, YAGNI):** family devices join the tailnet (one-time setup on their phones); the gate stays unchanged; account login lives entirely in the app layer.
   - **Option B:** extend the gate with a public family door — only if family must log in from devices outside the tailnet.
3. Verify the app-layer seams by reading: `packages/api/gateway/`, `packages/api/workspace-controller/src/`, `packages/credentials/authorization/src/`, `packages/session/session-persistence/src/`, `packages/settings/settings-file/src/`, `packages/identity/anonymous-user-id/src/`, `packages/client/web/`.

**Verify:** header of this file names the chosen option; seam list is annotated with the real entry points found.

## Task 2: account-registry package — store and lookup

**Objective:** Own the mapping account ↔ email ↔ OpenViking (account_id, user_id) ↔ dsh profile id.

**Files:**
- Create: `packages/account/account-registry/` (`@deepseek-ai/dsh-account-registry`): `src/index.ts`, `src/store.ts`, `tests/store.host.spec.ts`, `README.md`, `package.json`

**Step 1: Write failing test** — create account `timur` with email; `getByEmail("timur@example.com")` returns it (case-insensitive email); unknown email returns `null`; duplicate email rejected.

**Step 2: Run test, expect FAIL** (module missing): `pnpm run test` filtered to `store.host.spec`.

**Step 3: Implement minimal store** — JSON file at Config `storePath` (default under `~/.dsh/family/accounts.json`), written with mode `0600`, atomic rename on save. Record shape:

```ts
interface AccountRecord {
  accountId: string          // opaque id, lowercase slug owner-chosen (e.g. "timur")
  email: string              // normalized lowercase
  displayName: string
  ov: { accountId: string; userId: string } // OV identity the ov-adapter uses
  dshProfileId: string       // owner of dsh web sessions/settings/todos
  createdAt: string          // ISO 8601
}
```

**Step 4: Run test, expect PASS. Step 5: Commit** — `feat(account-registry): account store with email lookup`.

## Task 3: one-time login codes (TDD)

**Objective:** 6-digit codes and magic-link tokens, one-time, 10-minute TTL, stored hashed.

**Files:**
- Create: `packages/account/account-auth/src/secrets.ts`, `tests/secrets.host.spec.ts`

**Step 1: Failing tests** — issue() returns a plaintext code and stores only a hash; verify() accepts once, rejects second use; verify() rejects after 10 minutes; verify() rejects wrong code.

**Step 2: Run, expect FAIL.**

**Step 3: Implement** with `node:crypto` `scryptSync` + random 16-byte salt per secret; constant-time compare (`timingSafeEqual`):

```ts
const TTL_MS = 10 * 60 * 1000;
// code: 6 digits via randomInt(0, 1_000_000).padStart(6, "0")
// link token: randomBytes(32).toString("hex")
```

**Step 4: Run, expect PASS. Step 5: Commit** — `feat(account-auth): one-time hashed login codes and link tokens`.

## Task 4: letter request policy (TDD)

**Objective:** Neutral responses and letter rate limiting.

**Files:**
- Modify: `packages/account/account-auth/src/secrets.ts` (or new `policy.ts`), `tests/policy.host.spec.ts`

**Step 1: Failing tests** — unknown email and known email produce the identical response object; more than 3 letters per email per 15 min are refused with the same neutral response; at most 5 unverified codes alive per account.

**Step 2: FAIL → Step 3: implement counters in the auth store. Step 4: PASS. Step 5: Commit.**

## Task 5: sessions — access + rolling refresh (TDD)

**Objective:** Cookie model: access 15 min auto-renewed on use, refresh 30 days rolling, replay-safe, logout kills both.

**Files:**
- Create: `packages/account/account-auth/src/session.ts`, `tests/session.host.spec.ts`

**Step 1: Failing tests** — login creates session; access cookie renews `expiresAt` on use; refresh rotates the token and the old one is rejected; replay of the PREVIOUS refresh revokes the whole session; logout deletes both; refresh past 30 days fails.

**Step 2: FAIL → Step 3: implement** session record `{ sessionId, accountId, accessHash, refreshHash, prevRefreshHash, accessExpiresAt, refreshExpiresAt, lastUsedAt, device }`; cookies `fam_access` / `fam_refresh` are `HttpOnly; Secure; SameSite=Lax` opaque ids. **Step 4: PASS. Step 5: Commit.**

## Task 6: mail transport seam

**Objective:** Send the login letter (button link + 6-digit code) through a Config-typed transport.

**Files:**
- Create: `packages/account/account-mail/` (`@deepseek-ai/dsh-account-mail`): `src/index.ts` (Service Definition + `smtp` and `console` providers), `tests/mail.host.spec.ts`, `README.md`

**Steps:** failing test renders the letter with link + code and calls the transport; implement `console` provider (dev) and `smtp` provider (Config: host/port/user/pass/from — read from `credentials`, never hardcoded); PASS; commit `feat(account-mail): login letter transport seam`.

## Task 7: ov-adapter — server-side OV identity

**Objective:** Every OpenViking call runs with the owning user's identity; OV keys never reach a client.

**Files:**
- Create: `packages/account/account-ov-adapter/src/index.ts` + tests
- Integrate: `packages/credentials/credentials-local/` for OV key storage (Config path, `0600`)

**Steps:** failing test — given `dshProfileId`, the adapter resolves the account and issues OV requests as `ov.userId`; a client-supplied identity is ignored; keys are not exposed in any API response; PASS; commit.

## Task 8: API endpoints (account-controller)

**Objective:** Wire auth to the RPC gateway: `account/request-login`, `account/verify` (code or link), `account/refresh`, `account/logout`, `admin/rebind-email` (operator-only).

**Files:**
- Create: `packages/api/account-controller/` (`@deepseek-ai/dsh-account-controller`): `src/index.ts`, `src/routes.ts`, `tests/account-controller.host.spec.ts`
- Modify: `packages/api/gateway/` route registry (exact file found in Task 1 recon)

**Steps:** failing route tests (request-login always returns the neutral envelope; verify sets cookies; refresh rotates; logout clears; rebind-email requires operator role); implement; PASS; commit.

## Task 9: login screens (client)

**Objective:** Progressive-HTML screens inside dsh web: enter email → "check your mailbox" → enter backup code → inside; "I cannot log in" resends the letter.

**Files:**
- Create: `packages/client/ui-login/` (`@deepseek-ai/dsh-ui-login`): `src/`, `src/locales.ts` (ALL product copy goes through the locale dictionary — `verify-client-ui-i18n` rejects hardcoded copy)
- Modify: `packages/client/web/` slot registration (exact slot file from Task 1 recon)

**Steps:** implement screens against the Task 8 endpoints; add locale entries EN+RU; commit `feat(ui-login): passwordless family login screens`.

## Task 10: dsh web state isolation (the "!!!!" requirement)

**Objective:** Chats, sessions, todos, settings, presets carry an owner and are filtered by it; one account can never list or open another account's state.

**Files:**
- Modify: `packages/session/session-persistence/src/` (owner field + filtering), `packages/session/session-projection/src/`
- Modify: `packages/settings/settings-file/src/` (per-profile settings path)
- Modify: `packages/api/workspace-controller/src/` and `packages/api/session-controller/src/` (owner-scoped queries — session-controller is currently WIP in this tree; coordinate with that work)
- Test: `packages/api/session-controller/tests/cross-account.host.spec.ts`

**Steps:** failing cross-account probe tests (account A cannot see B's sessions/todos/settings, via both list and direct id); implement owner scoping at the persistence layer (filter on read, stamp on write); PASS; commit `feat(session): owner-scoped dsh web state isolation`.

## Task 11: admin plan-B surface + audit log

**Objective:** Operator can rebind a lost mailbox; every entry attempt lands in an operator-visible audit log.

**Files:**
- Create: `packages/account/account-audit/src/` (append-only JSONL at Config `auditPath`)
- Modify: `packages/api/account-controller/src/routes.ts` (rebind-email + audit reads)

**Steps:** failing tests (rebind sends a fresh letter to the new address and invalidates old login codes; unknown-email response unchanged; audit records success and failure attempts with timestamp + device); implement; PASS; commit.

## Task 12: acceptance pass + docs

**Objective:** Prove the spec's acceptance criteria; satisfy repo documentation rules.

**Steps:**
1. Cross-account acceptance suite green (Task 10 tests + link/code one-time + expiry + logout + rotation-replay).
2. Snapshot: add a keyless recorded-session snapshot for the login flow output (repo testing policy).
3. Docs: package READMEs + `docs/` touch-points; **Agent Note in the same PR** (repo rule for non-trivial changes); run `pnpm run doc-sync`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`.
4. Report done.

## Out of scope (own spec → plan cycles later)

- **S2** mail production hardening (SPF/DKIM, templates, new-entry notifications).
- **S3** OV provisioning model (one family account with users vs account per member; explicit family scope for shared content).
- **S4** personalization (per-account persona — `packages/preset/persona/` is the seam — voice, avatar, theme).
