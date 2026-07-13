# External Security Review — Response (2026-07-10)

An external (ChatGPT) review flagged issues before deployment. Every claim was
verified against the code first. This file records what was **fixed**, what
needs a **dashboard action** (no code can do it), and what is **deferred** with
reasoning — so nothing silently disappears.

## Fixed in code (this commit)

| # | Issue (verified) | Fix |
|---|---|---|
| 1 | **`public.leaderboard` readable with the anon key** — Supabase default privileges granted the view to `anon`; owner-rights view bypasses RLS. Confirmed by the reviewer with a live unauthenticated request. | Migration **081**: `REVOKE` anon/PUBLIC, re-grant `authenticated` only, and the view itself now requires `core.is_approved()` — anon/pending accounts get zero rows even if a grant slips back in. |
| 2 | **Pending coach → private proof photos** — link-insert policy checked `is_approved()` only in `USING`, not `WITH CHECK`; storage read policy trusted any active link. | Migration **081**: `WITH CHECK` now requires approved coach; storage policy requires `current_role()='coach' AND is_approved()` too. |
| 3 | **`log_audit` executable by anon** → forged audit entries attributed to any user (anon hits the `auth.uid() IS NULL` fallback). | Migration **081**: `REVOKE` PUBLIC/anon execute; `authenticated` + `service_role` only; `search_path = ''`. |
| 4 | **Service worker cached all Supabase responses** (`supabase-api-cache`) — could replay one user's data to another on a shared device. | Caching rule removed from [vite.config.ts](../vite.config.ts); leftover bucket deleted on app start ([main.tsx](../src/main.tsx)) and on sign-out. |
| 5 | **Nothing was cleared on sign-out** — React Query memory, offline IndexedDB drafts/queue survived across accounts on a shared device. | `useSignOut` now clears the query cache, IndexedDB (`clearOfflineData()`), and the legacy SW cache. Both logout UIs (Header, MaintenanceMode) route through it. |
| 6 | **6-character passwords accepted at registration.** | Register schema now requires **8+** ([Login.tsx](../src/pages/Login.tsx)); i18n texts updated (EN/BM). Sign-in stays at 6 so pre-existing accounts can still log in. `ResetPassword` already required 8 (review claim was wrong there). |
| 7 | **Proof photos stored `getPublicUrl()` results from a private bucket** (dead URLs; and would be an exposure if the bucket were ever made public). | [scores.ts](../src/services/scores.ts) now stores the object **path**; all viewers already resolve paths via `createSignedUrl` (admin2/coach Scores, PLD validation). Legacy full-URL rows keep working through their `startsWith('http')` branch. |
| 8 | **No security headers.** | [public/_headers](../public/_headers) added for Cloudflare Pages: CSP (origins tuned to Supabase/Google Fonts/Turnstile), `frame-ancestors 'none'`, `nosniff`, referrer + permissions policies. |
| 9 | Migration audit script stopped at 079. | Extended to probe **080** and **081** ([AUDIT_migration_state.sql](../supabase/AUDIT_migration_state.sql)). |

**⚠️ Migration 081 must be RUN MANUALLY in the Supabase SQL Editor** (after 080).
Verify afterwards: run `AUDIT_migration_state.sql` — row 081 must read OK — and an
anon `curl https://<ref>.supabase.co/rest/v1/leaderboard?select=name&apikey=<anon>`
must return an error/empty, not data.

## Dashboard actions (cannot be done in code)

1. **Auth → Email**: turn OFF auto-confirm; require email verification.
2. **Auth → Passwords**: set minimum length 8+ (the form now enforces it, the
   server should too); enable leaked-password protection if available.
3. **Auth → MFA**: keep TOTP challenge/verification enabled. Role-specific
   enforcement is **not dashboard-only**; `/admin-mfa` plus migration 086 now
   require an AAL2 session for admin1 / admin2 / super_admin. Separately enforce
   MFA for Supabase organization/dashboard owners.
4. **Auth → Sessions**: set inactivity + absolute session limits.
5. **Storage**: confirm `proof-photos` and `certifications` buckets are **Private**.
6. Run **Security Advisor**; acknowledge the expected `security_definer_view`
   finding on `public.leaderboard` (documented in migrations 075/081).
7. Enable **backups / PITR** before real student data is collected.
8. **Cloudflare Pages**: protect preview deployments with Cloudflare Access;
   consider a separate staging Supabase project.

## Second review follow-up (2026-07-11)

A second review pass pushed back on the deferrals. Resolved:

- **#2 Coach could unilaterally link any archer → read their proof photos** —
  was only half-closed. **Migration 082**: coach-initiated links (`coach_link_archer`)
  are now `pending` with an `initiated_by='coach'` marker; a trigger blocks the
  coach from self-activating them; the **archer approves** via
  `archer_respond_coach_link` (new "Coach requests" card on the archer Profile).
  The school-code flow (archer pre-consented) is untouched and still coach-approved.
- **#3 Cleanup bypassed by password-recovery / automatic SIGNED_OUT** — fixed;
  purge moved into the `onAuthStateChange` SIGNED_OUT handler (commit `67a8e31`).
- **#4 `xlsx` 0.18.5** — **upgraded** to the patched SheetJS `0.20.3` (installed
  from `cdn.sheetjs.com`; npm has no ≥0.19). `npm audit` now reports **0
  vulnerabilities**. Note: the Cloudflare build fetches this tarball at
  `npm ci` time — it needs network access to cdn.sheetjs.com (it has it).
- **#5 Leaderboard shows minors' full name / school / age / gender** —
  **ACCEPTED as-is (decision 2026-07-11)**: full names stay on the board.
  Documented, deliberate product decision. Revisit if a guardian-consent
  requirement arises.

## Still deferred (deliberate, with reasons)

- **DOMPurify for the article block editor** — new dependency; current custom
  sanitizer covers script/iframe/event-handler basics and articles are
  admin-authored (trusted authors), not user-generated. Swap in DOMPurify later.
- **Vite 5 → 6 major bump** — dev-tooling advisory; do as its own tested change.
- **Splitting `SELECT *` compatibility views (profiles/schools)** — real
  minimization win but touches every service; needs its own careful pass.
- **Server-side Turnstile for `/forgot-email`** — the table already has a
  DB-side rate limit (migration 055, missed by the review). Full fix needs an
  Edge Function; schedule separately.
- **Renaming duplicate migration files (055/056/057)** — files are already
  applied under these names; this project runs migrations manually (no
  `supabase db push` history to corrupt). Renaming now would only confuse the
  audit trail. New migrations must keep using unique ascending numbers.

## Third follow-up: local build after 082

Migration **083** is prepared for the remaining code-side hardening. It is not
live until run manually after 082. It makes the achievement-grant RPCs
internal-only, locks the remaining SECURITY DEFINER search paths, requires an
approved account for protected storage/certification writes, serializes archer
coach-consent responses, and bounds client-written audit events. The auth
listener also purges local data when one signed-in identity is replaced by
another, not only on `SIGNED_OUT`.

The Cloudflare CSP now permits the YouTube and Vimeo origins already supported
by the article block editor. No Supabase API/private-data caching was restored.

## Fourth follow-up: scale read paths and real admin MFA

Migrations **084-085** add internal leaderboard snapshots, guarded cursor RPCs,
single-scan summaries and bounded Admin 2 review queues. The leaderboard,
coach leaderboard, Admin 2 users, scores, certifications and change requests
now request 50 visible rows at a time with a hard database maximum of 100.

Migration **086** changes the shared authorization helpers so an approved
application admin is not privileged until the JWT has `aal2`. It must be
coordinated with deployment of `/admin-mfa`; see
`docs/scaling-rollout-2026-07-11.md` for the safe order.
