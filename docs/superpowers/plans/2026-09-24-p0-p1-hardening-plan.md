# P0/P1 Hardening and Production Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the approved P0/P1 security and data-integrity findings, verify the fixes with regression tests, and deploy the compatible Worker/Assets build through the local proxy at `127.0.0.1:10081` before rechecking `https://sort.logicc.top/`.

**Architecture:** Add a small outbound-request policy seam at `worker/outbound.ts` and route media, AI, and mail requests through it. Bind QR transactions to the authenticated user in a D1-backed owner table, make code/verification and Plaza mutations conditional on the current database row, and keep ranking/profile/notes semantics in the existing focused libraries. Add only backward-compatible D1 migrations; do not introduce a Durable Object in this release.

**Tech Stack:** React 19, TypeScript 5.7, Vite 6, Vitest 2, Cloudflare Workers, D1/SQLite, Wrangler 4, Node 22+.

---

## File map

### Create

- `worker/outbound.ts` — protocol/host/redirect/timeout/body-budget policy.
- `worker/outbound.test.ts` — pure URL policy and bounded-response tests.
- `worker/mailer.test.ts` — production fail-closed and development fallback tests.
- `worker/qrTransactions.ts` — D1 owner lookup/register/terminal cleanup.
- `worker/qrTransactions.test.ts` — owner, expiry, and cleanup behavior against a deterministic fake D1.
- `migrations/0024_qr_transactions.sql` — QR key/provider/user/TTL binding.
- `migrations/0025_runtime_indexes.sql` — lookup/cleanup indexes for sessions, OAuth, verification codes, and Plaza user queries.
- `src/lib/profileSync.ts` — explicit empty-notes payload and sync request-generation helper.
- `src/lib/profileSync.test.ts` — notes omission/clear and stale-generation tests.

### Modify

- `worker/media.ts` — exact Douban URL validation, bounded fetch, throttle outcome preservation.
- `worker/ai.ts` — shared bounded outbound policy, safe model path encoding, redirect control.
- `worker/mailer.ts` — bounded provider responses and explicit environment fallback.
- `worker/index.ts` — QR issue/poll owner arguments, admin/stats/route budgets, safe CSV/error handling.
- `worker/netease.ts` — QR owner lookup and terminal cleanup.
- `worker/douban.ts` — QR owner lookup, bounded QR image fetch, terminal cleanup.
- `worker/account.ts` — strict Google verification, atomic code/exchange consumption, notes field presence, request/environment typing.
- `worker/plaza.ts` — object/boolean/pagination validation, immutable post type, same-post parent checks, conditional counters/deletes.
- `src/lib/ranking.ts` — integer quick estimate and backward-compatible snapshot decoding.
- `src/lib/profile.ts` — one ID/identity/rank/merge validation path.
- `src/lib/useAuth.ts` — hydration gate, generation-aware sync, explicit empty notes.
- `src/App.tsx` — conflict merge carries notes and uses the sync payload helper.
- `package.json` — only add non-destructive verification/deploy-check scripts if the implementation needs them.
- `README.md`, `docs/CLOUDFLARE.md`, `docs/API.md` — update migration, Node, mailer, and security behavior after code is verified.

### Do not modify in this release

- `src/lib/exportPng.ts` PNG budget work.
- Service Worker/PWA icon work.
- Large `App.tsx` decomposition.
- Durable Object/rate-limit topology migration.
- Destructive table rebuilds or production data deletion.

---

### Task 1: Establish the failing security-policy tests

**Files:**
- Create: `worker/outbound.test.ts`
- Create: `worker/mailer.test.ts`
- Modify: `worker/ai.test.ts` only to add the new redirect/model cases after the policy interface exists.

- [ ] **Step 1: Write failing URL-policy tests**

Create tests that describe these exact cases:

```ts
import { describe, expect, it, vi } from "vitest";
import { OutboundError, fetchBounded, parseAllowedUrl, readBoundedText } from "./outbound";

const doubanPolicy = {
  allowedHosts: ["book.douban.com", "movie.douban.com"],
  maxBytes: 1024,
  timeoutMs: 1000,
  maxRedirects: 2,
} as const;

describe("outbound policy", () => {
  it("accepts an exact allowed host and subject path", () => {
    expect(parseAllowedUrl("https://book.douban.com/subject/123/", doubanPolicy).hostname).toBe(
      "book.douban.com",
    );
  });

  it("rejects a host that only contains the allowed substring", () => {
    expect(() =>
      parseAllowedUrl("https://attacker.example/book.douban.com/subject/123", doubanPolicy),
    ).toThrow(OutboundError);
  });

  it("rejects http, credentials, and non-allowed ports", () => {
    expect(() => parseAllowedUrl("http://book.douban.com/subject/123", doubanPolicy)).toThrow();
    expect(() => parseAllowedUrl("https://u:p@book.douban.com/subject/123", doubanPolicy)).toThrow();
    expect(() => parseAllowedUrl("https://book.douban.com:8443/subject/123", doubanPolicy)).toThrow();
  });

  it("does not follow a redirect to another host", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    await expect(
      fetchBounded("https://book.douban.com/subject/123", {}, doubanPolicy, fetchImpl),
    ).rejects.toThrow(OutboundError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a response body over maxBytes", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(1025), { status: 200 }));
    const response = await fetchBounded(
      "https://book.douban.com/subject/123",
      {},
      doubanPolicy,
      fetchImpl,
    );
    await expect(readBoundedText(response, doubanPolicy.maxBytes)).rejects.toThrow(OutboundError);
  });
});
```

Keep each test independent of a real network.

- [ ] **Step 2: Write failing mailer configuration tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { sendVerificationCode } from "./mailer";

describe("verification mailer", () => {
  it("fails closed when no provider is configured in production", async () => {
    const result = await sendVerificationCode({ ENVIRONMENT: "production" }, "a@example.com", "123456", "register");
    expect(result).toEqual({ ok: false, reason: "mailer_unconfigured" });
  });

  it("does not log the OTP when production is unconfigured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendVerificationCode({ ENVIRONMENT: "production" }, "a@example.com", "123456", "reset");
    expect(warn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```text
npm test -- --run worker/outbound.test.ts worker/mailer.test.ts
```

Expected: FAIL because `./outbound` and the new `ENVIRONMENT` behavior do not exist yet. Do not change production code before recording this failure.

- [ ] **Step 4: Commit the red tests only after the failure is confirmed**

```text
git add worker/outbound.test.ts worker/mailer.test.ts
 git commit -m "test: define outbound and mailer safety contracts"
```

---

### Task 2: Implement the outbound policy seam and integrate media/AI/mailer

**Files:**
- Create: `worker/outbound.ts`
- Modify: `worker/media.ts`, `worker/ai.ts`, `worker/mailer.ts`
- Test: `worker/outbound.test.ts`, `worker/ai.test.ts`, `worker/mailer.test.ts`

- [ ] **Step 1: Implement the smallest policy Interface**

Use these exported names and signatures throughout the worker:

```ts
export interface OutboundPolicy {
  allowedHosts: readonly string[];
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  allowedContentTypes?: readonly string[];
}

export class OutboundError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OutboundError";
  }
}

export function parseAllowedUrl(value: string, policy: OutboundPolicy): URL;
export function fetchBounded(
  input: string | URL,
  init: RequestInit,
  policy: OutboundPolicy,
  fetchImpl?: typeof fetch,
): Promise<Response>;
export async function readBoundedText(response: Response, maxBytes: number): Promise<string>;
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown>;
```

`fetchBounded` must parse the initial URL, set an abort signal from `timeoutMs`, use `redirect: "manual"`, validate every `Location` against the same exact host set, cap redirects at `maxRedirects`, and return the final response without reading the body. `readBoundedText` must use `response.body.getReader()` when available, count UTF-8 bytes, abort on the first chunk over `maxBytes`, and cancel the reader. `readBoundedJson` must call the bounded text reader before `JSON.parse`.

- [ ] **Step 2: Run the focused policy tests and verify GREEN**

Run:

```text
npm test -- --run worker/outbound.test.ts
```

Expected: all outbound policy tests pass.

- [ ] **Step 3: Replace detail-page substring checks with exact policy checks**

In `worker/media.ts`, import the policy helpers and replace `fetchDetailPage`’s raw `fetch` with a policy-bound request. Before calling the detail function, validate:

```ts
const detailPolicy = {
  allowedHosts: ["book.douban.com", "movie.douban.com"],
  maxBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 2,
  allowedContentTypes: ["text/html", "application/xhtml+xml"],
} as const;
```

Replace `url.includes("book.douban.com/subject/")` and the movie equivalent with a host/path check based on the parsed URL. Preserve the existing anti-bot fallback behavior after reading the bounded body.

- [ ] **Step 4: Make AI model paths and model listing use the same policy**

In `worker/ai.ts`, keep the existing user-facing validation but add a bounded dynamic-host policy for the configured base URL. Encode Gemini model names as one path segment with `encodeURIComponent`, and make `listModelsForProtocol` use `fetchBounded(..., { redirect: "manual" }, policy)`. Preserve the API-key headers only on the allowed host. Add tests for a model containing `/` and for a model-list 302 response.

- [ ] **Step 5: Bound mailer responses and gate development fallback**

Extend `MailerEnv` with `ENVIRONMENT?: "production" | "development" | "test"`. In `sendVerificationCode`, return `{ ok: false, reason: "mailer_unconfigured" }` unless `ENVIRONMENT === "development" || ENVIRONMENT === "test"`. The development branch may log only a non-secret diagnostic; it must not include `to` or `code`. Pass `redirect: "manual"`, timeout, and `readBoundedText` to both provider calls.

- [ ] **Step 6: Run focused integration tests**

Run:

```text
npm test -- --run worker/outbound.test.ts worker/ai.test.ts worker/mailer.test.ts worker/content-intro-music.test.ts
```

Expected: PASS with no unhandled network calls.

- [ ] **Step 7: Commit the security seam**

```text
git add worker/outbound.ts worker/outbound.test.ts worker/media.ts worker/ai.ts worker/mailer.ts worker/mailer.test.ts worker/ai.test.ts
git commit -m "fix(security): bound outbound requests and close media AI mailer gaps"
```

---

### Task 3: Bind QR transactions to the authenticated user

**Files:**
- Create: `worker/qrTransactions.ts`, `worker/qrTransactions.test.ts`
- Create: `migrations/0024_qr_transactions.sql`
- Modify: `worker/index.ts`, `worker/netease.ts`, `worker/douban.ts`
- Test: `worker/qrTransactions.test.ts`

- [ ] **Step 1: Write failing owner-binding tests**

Test these behaviors with a fake D1:

```ts
it("rejects a poll whose user differs from the issue owner", async () => {
  await registerQrTransaction(db, "netease", "key-a", 10, 120_000);
  await expect(getQrTransaction(db, "netease", "key-a", 11)).resolves.toBeNull();
  await expect(getQrTransaction(db, "netease", "key-a", 10)).resolves.toMatchObject({ user_id: 10 });
});

it("consumes a transaction exactly once at terminal cleanup", async () => {
  await registerQrTransaction(db, "douban", "code-a", 10, 120_000);
  await expect(consumeQrTransaction(db, "douban", "code-a", 10)).resolves.toBe(true);
  await expect(getQrTransaction(db, "douban", "code-a", 10)).resolves.toBeNull();
  await expect(consumeQrTransaction(db, "douban", "code-a", 10)).resolves.toBe(false);
});
```

Also cover expired rows and provider/key isolation.

- [ ] **Step 2: Add the backward-compatible migration**

```sql
CREATE TABLE IF NOT EXISTS qr_transactions (
  provider TEXT NOT NULL CHECK (provider IN ('netease', 'douban')),
  transaction_key TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES user_accounts(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (provider, transaction_key)
);
CREATE INDEX IF NOT EXISTS idx_qr_transactions_expires ON qr_transactions(expires_at);
CREATE INDEX IF NOT EXISTS idx_qr_transactions_user ON qr_transactions(user_id, provider);
```

Do not add a destructive cleanup or foreign-key cascade in this migration.

- [ ] **Step 3: Run the QR tests and verify RED**

Run:

```text
npm test -- --run worker/qrTransactions.test.ts
```

Expected: FAIL because the helper and table do not exist.

- [ ] **Step 4: Implement the small D1 repository**

`registerQrTransaction` uses `INSERT OR REPLACE` with an expiry generated from `Date.now() + ttl`. `getQrTransaction` selects only a non-expired row for the requested provider/key/user. `consumeQrTransaction` issues `DELETE ... WHERE provider = ? AND transaction_key = ? AND user_id = ? AND expires_at > datetime('now')` and returns `meta.changes === 1`. A cleanup statement deletes expired rows and is safe to call in a scheduled handler.

- [ ] **Step 5: Pass the authenticated user through issue and poll routes**

In `worker/index.ts`, authenticate before issuing either QR, call the provider issue function with the authenticated user ID, register the returned key, and return the existing public response shape. On poll, call `getQrTransaction` first; return a stable `qr_expired_or_invalid` response for a missing/expired/foreign key. Only after that check may the provider poll function call `saveProviderCookie`; on confirmed/expired/risk terminal states call `consumeQrTransaction`. Keep waiting/scanned rows alive for subsequent polls.

- [ ] **Step 6: Harden the Douban QR image request**

Before fetching the upstream `img` URL, parse and allow only the known Douban image host set, use the bounded policy, and accept only image content types. Do not convert a failed/oversized/non-image response into a data URL.

- [ ] **Step 7: Run QR and existing account/import tests**

Run:

```text
npm test -- --run worker/qrTransactions.test.ts worker/plazaPayload.test.ts worker/payloadGuard.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the QR owner binding**

```text
git add migrations/0024_qr_transactions.sql worker/qrTransactions.ts worker/qrTransactions.test.ts worker/index.ts worker/netease.ts worker/douban.ts
git commit -m "fix(auth): bind provider QR transactions to their owner"
```

---

### Task 4: Fix ranking snapshots and profile invariants

**Files:**
- Modify: `src/lib/ranking.ts`, `src/lib/profile.ts`
- Test: `src/lib/ranking.test.ts`, `src/lib/profile.test.ts`

- [ ] **Step 1: Add failing ranking snapshot tests**

```ts
it("round-trips a quick snapshot after the first decision", () => {
  const initial = createRankingState(ids(5), { seed, topN: 2, mode: "quick" });
  const next = chooseSide(initial, "left");
  const restored = deserializeRankingState(serializeRankingState(next));
  expect(restored.sourceIds).toEqual(next.sourceIds);
  expect(restored.estimatedTotalComparisons).toBe(next.estimatedTotalComparisons);
});
```

Add a fixture with a legacy finite fractional `estimatedTotalComparisons` and assert it is accepted and normalized, not thrown.

- [ ] **Step 2: Add failing profile invariant tests**

Cover: a 180-character ID accepted by the shared projection, duplicate explicit IDs removed deterministically, `reorderRanking` rejecting duplicate/missing/foreign IDs, and `mergeProfiles` stopping at the configured profile limit.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```text
npm test -- --run src/lib/ranking.test.ts src/lib/profile.test.ts
```

Expected: the new quick round-trip and invariant assertions fail against the current code.

- [ ] **Step 4: Implement the minimal ranking/profile changes**

In `createRankingState`, calculate quick estimate with `Math.ceil` and keep all state fields finite/non-negative. In `deserializeRankingState`, normalize a finite legacy estimate to `Math.ceil` before shape validation. In `profile.ts`, make the parser’s ID limit match `shared/storedItem.ts`, reject/deduplicate explicit IDs in one deterministic path, make `reorderRanking` compare `new Set(newOrder)` with the original set, and cap merged profiles by the existing product limits before returning.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```text
npm test -- --run src/lib/ranking.test.ts src/lib/profile.test.ts
```

Expected: all existing and new tests pass.

- [ ] **Step 6: Commit the data invariants**

```text
git add src/lib/ranking.ts src/lib/ranking.test.ts src/lib/profile.ts src/lib/profile.test.ts
git commit -m "fix(data): close ranking and profile invariant gaps"
```

---

### Task 5: Make notes clearing and account synchronization explicit

**Files:**
- Create: `src/lib/profileSync.ts`, `src/lib/profileSync.test.ts`
- Modify: `src/lib/useAuth.ts`, `src/App.tsx`, `shared/storedItem.ts`, `shared/storedNotes.test.ts`, `worker/account.ts`
- Test: `src/lib/profileSync.test.ts`, existing account/profile tests

- [ ] **Step 1: Write failing sync payload tests**

Test that a profile PUT with no notes omits the field, a profile PUT with `{}` includes an explicit empty notes object, and a stale generation cannot be applied after a newer request starts.

- [ ] **Step 2: Implement `profileSync.ts`**

Export a pure `buildProfileSyncBody(profile, notes, includeNotes)` and a `SyncGeneration` helper:

```ts
export function buildProfileSyncBody(
  profile: ArtisticProfile,
  notes: Record<string, string>,
  includeNotes: boolean,
): { profile: ArtisticProfile; notes?: Record<string, string> } {
  return includeNotes ? { profile, notes } : { profile };
}

export function isCurrentGeneration(current: number, received: number): boolean {
  return current === received;
}
```

- [ ] **Step 3: Add a hydration gate to `useAuth`**

Track `cloudHydrated` and the current token generation. The automatic-sync effect must return until hydration is complete. Every account load/OAuth restore increments the generation and aborts the previous controller. `accountSave` and `syncProfile` must include notes on explicit save/merge, including `{}`; ordinary profile loads that do not intend to change notes must omit the field. On logout, abort the active request and clear the timer before removing local state.

- [ ] **Step 4: Make the server distinguish omitted notes from explicit `{}`**

In `worker/account.ts`, parse the request body once, detect `Object.hasOwn(body, "notes")`, encode that field only when present, and bind `null` only for the omitted case. The UPDATE must use a presence-aware branch or two statements so `{}` replaces old notes while an absent field preserves them. Do not log note contents.

- [ ] **Step 5: Update conflict merge in `App.tsx`**

When the user chooses incremental merge, send the merged profile and the explicitly merged notes map in the same request. When applying cloud data, replace both profile and notes atomically in the local UI state. Preserve the existing cancellation behavior for share/OAuth requests.

- [ ] **Step 6: Run the focused tests and typecheck**

Run:

```text
npm test -- --run src/lib/profileSync.test.ts shared/storedNotes.test.ts src/lib/profile.test.ts
npm run check
```

Expected: PASS/exit 0.

- [ ] **Step 7: Commit the sync semantics**

```text
git add src/lib/profileSync.ts src/lib/profileSync.test.ts src/lib/useAuth.ts src/App.tsx shared/storedItem.ts shared/storedNotes.test.ts worker/account.ts
git commit -m "fix(sync): make cloud hydration and empty notes explicit"
```

---

### Task 6: Make OAuth and verification consumption conditional

**Files:**
- Modify: `worker/account.ts`
- Create: `worker/verification.ts`, `worker/verification.test.ts`
- Create: `migrations/0025_runtime_indexes.sql`
- Test: `worker/verification.test.ts`

- [ ] **Step 1: Write failing helper tests**

Cover a valid code consumed once, a concurrent second consume returning false, a wrong code incrementing attempts without deleting the row, an expired code not consumable, and an OAuth exchange row being returned to only one caller.

- [ ] **Step 2: Add the compatibility index migration**

```sql
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_oauth_user ON user_oauth(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires ON verification_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_plaza_likes_user ON plaza_likes(user_id, post_id);
CREATE INDEX IF NOT EXISTS idx_plaza_comments_user ON plaza_comments(user_id, post_id);
```

- [ ] **Step 3: Implement conditional verification consumption**

`consumeVerificationCode` first selects a non-expired row, then performs a conditional delete keyed by `id`, `code_hash`, `attempts < 5`, and expiry. It returns `consumed`, `locked`, `expired`, or `invalid` based on `meta.changes` and a bounded follow-up read. The issue path uses a D1 `batch` to delete/replace the active `(email,purpose)` rows; registration/reset only consumes after the user mutation succeeds, or uses a recoverable pending state if the schema cannot be changed safely.

- [ ] **Step 4: Make OAuth exchange one-time under concurrency**

Read the row, then delete with `WHERE code = ? AND expires_at > datetime('now')`; only the caller whose delete reports one change may return the token. Keep the existing `token` column for backward-compatible rollout; token-at-rest hashing is deferred until a table-rebuild migration is explicitly approved. Clear the OAuth state cookie after successful callback.

- [ ] **Step 5: Require Google verification and run tests**

Change Google parsing to `d.email_verified === true`; add a test for a missing/false field. Run:

```text
npm test -- --run worker/verification.test.ts worker/ai.test.ts
npm run check
```

Expected: PASS/exit 0.

- [ ] **Step 6: Commit account atomicity changes**

```text
git add worker/account.ts worker/verification.ts worker/verification.test.ts migrations/0025_runtime_indexes.sql
git commit -m "fix(auth): make verification and OAuth exchange one-time"
```

---

### Task 7: Harden Plaza writes and counters

**Files:**
- Modify: `worker/plaza.ts`
- Modify: `worker/plazaPayload.test.ts`
- Create: `worker/plazaIntegrity.test.ts`
- Test: `worker/plazaIntegrity.test.ts`

- [ ] **Step 1: Add failing route tests**

Add cases for JSON `null`, `is_public: "false"`, `page=Infinity`, changing only `post_type`, a parent comment from another post, double-toggle races, and a nested reply deletion. Assert the response is a stable 4xx where applicable and that the SQL write uses a conditional `changes` result or a batch.

- [ ] **Step 2: Add one shared request parser**

Use `readJsonObject` for create/edit/comment routes, require finite integer page/limit, accept only booleans/0/1 for visibility, and reject unknown post types. On edit, do not allow `post_type` to change; if a client sends it, require it to equal the stored value and require items to match the stored type.

- [ ] **Step 3: Validate comment parents and visibility**

Before inserting a reply, select the parent’s `post_id` and reject a mismatch. Reject non-boolean visibility values instead of applying JavaScript truthiness.

- [ ] **Step 4: Make like/comment/counter writes conditional**

Use `INSERT OR IGNORE`/`DELETE` and inspect `meta.changes` before changing the counter. Put the row mutation and counter update in `DB.batch` or a transaction-equivalent sequence. Deleting a comment or account must recompute affected counters from rows, not assume one deleted row means one decrement.

- [ ] **Step 5: Run Plaza tests and commit**

Run:

```text
npm test -- --run worker/plazaPayload.test.ts worker/plazaIntegrity.test.ts
npm run check
```

Expected: PASS/exit 0.

```text
git add worker/plaza.ts worker/plazaPayload.test.ts worker/plazaIntegrity.test.ts
git commit -m "fix(plaza): enforce post shape and write integrity"
```

---

### Task 8: Exercise migrations locally and verify backward compatibility

**Files:**
- Create/modify: `migrations/0024_qr_transactions.sql`, `migrations/0025_runtime_indexes.sql`
- Optional test script: `scripts/d1-smoke.mjs` only if existing Wrangler output cannot provide a repeatable check.

- [ ] **Step 1: Apply all migrations to a clean local D1**

Run through the configured proxy where Wrangler needs network access:

```text
$env:HTTPS_PROXY='http://127.0.0.1:10081'
$env:HTTP_PROXY='http://127.0.0.1:10081'
npx wrangler d1 migrations apply film-sort --local
```

Expected: all migrations report applied, including 0024 and 0025.

- [ ] **Step 2: Apply migrations a second time**

Run the same command again. Expected: no duplicate-table/index errors and no destructive reset.

- [ ] **Step 3: Inspect schema and run a local Worker smoke**

Run:

```text
npx wrangler d1 execute film-sort --local --command "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name IN ('qr_transactions','idx_verification_codes_expires') ORDER BY name"
npm run worker:dev
```

Use a managed background job for the dev server, then request `/api/health`, `/api/plaza/posts?page=1&limit=1`, and the local home page. Stop the job after the smoke and record the output.

- [ ] **Step 4: Commit migration smoke evidence in the progress report**

Update `progress.md` with command output, not a claim of production safety.

---

### Task 9: Run the complete local quality gate

**Files:** No new source files; all changed code and tests from Tasks 1–8.

- [ ] **Step 1: Run typecheck, lint, format, and tests**

```text
npm run check
npm run lint
npm run format:check
npm test -- --run
```

Expected: check/lint/format exit 0; no test failures. Lint warnings must be reported separately rather than hidden.

- [ ] **Step 2: Build the production assets**

```text
npm run build
```

Expected: exit 0. Record chunk-size warnings; do not treat them as pass/fail.

- [ ] **Step 3: Run both dependency audits**

```text
npm audit --package-lock-only --registry=https://registry.npmjs.org
npm audit --package-lock-only --omit=dev --registry=https://registry.npmjs.org
```

Expected: record the full development result and the production-only result separately. Do not report the development audit as clean if it exits non-zero.

- [ ] **Step 4: Inspect the final diff and worktree**

```text
git diff --check
git status --short
git log -5 --oneline
```

Expected: no whitespace errors; only intended source, migration, test, design, and report files are present.

---

### Task 10: Deploy through the local proxy and re-verify the production URL

**Files:** No code changes unless a deployment failure requires a new TDD fix.

- [ ] **Step 1: Set the proxy only for the deployment process**

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:10081'
$env:HTTP_PROXY='http://127.0.0.1:10081'
$env:CURL_PROXY='http://127.0.0.1:10081'
```

- [ ] **Step 2: Apply the remote migration and deploy**

Run the existing deployment path only after local checks pass:

```text
npx wrangler d1 migrations apply film-sort --remote
npx wrangler deploy
```

If the migration or deploy command exits non-zero, stop, preserve the output, and do not claim remote success.

- [ ] **Step 3: Verify the public HTTPS origin**

Use `curl.exe` with the proxy and capture status, redirect location, security headers, and body markers:

```text
curl.exe -sS -x http://127.0.0.1:10081 -D - https://sort.logicc.top/ -o .tmp/production-home.html
curl.exe -sS -x http://127.0.0.1:10081 -D - https://sort.logicc.top/api/health
curl.exe -sS -x http://127.0.0.1:10081 -D - "https://sort.logicc.top/api/book/detail?url=https%3A%2F%2Fevil.example%2Fbook.douban.com%2Fsubject%2F123"
```

Expected: home and health return successful responses; the malicious detail-shaped URL is rejected or never reaches an unapproved host. Do not execute authenticated POST/DELETE requests against production.

- [ ] **Step 4: Re-run the URL through a browser smoke**

Load `https://sort.logicc.top/` in a fresh background tab, wait for the app shell, inspect `document.title`, visible text, and console/network errors, then close only the tab created for this check. Do not log in or scan a provider account.

- [ ] **Step 5: Record the deployment evidence**

Update `progress.md` and `findings.md` with the exact remote migration/deploy exit codes, URL status/header evidence, and any remaining limitations. Do not claim the production URL is fully secure without the runtime tests.

---

### Task 11: Final report and handoff

**Files:**
- Modify: `findings.md`, `progress.md`, `task_plan.md`

- [ ] **Step 1: Mark each finding as fixed, mitigated, deferred, or still open**

For every P0/P1 ID, record the exact changed files and verification command. Preserve unresolved items such as Durable Object atomicity, DNS rebinding limits, PNG, Service Worker, and CI gaps.

- [ ] **Step 2: Run one final status check and present deliverables**

```text
git status --short
```

Present the updated report files to the user. The final response must distinguish code changes, local tests, remote deployment, production smoke results, and remaining risks.
