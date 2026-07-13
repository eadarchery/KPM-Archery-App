# Supabase + Cloudflare Pages scaling rollout

This branch prepares the highest-volume read paths, but it does not claim that
the current Supabase compute tier can absorb 40,000 simultaneous requests. That
must be proven with a staging load test and Supabase metrics.

## Request and row math

- 40,000 people opening one 50-row page is about 40,000 API requests and up to
  2,000,000 returned rows. It is not 2,000,000 API calls.
- Moving to page two creates one additional request only for users who choose
  to continue.
- The UI requests 51 rows internally: 50 displayed rows and one row used only
  to determine whether a next page exists. The database hard maximum is 100.

## Data path

1. Cloudflare Pages serves versioned HTML, JavaScript, CSS and images.
2. Authenticated/private API responses go directly to Supabase and remain
   protected by authentication, RPC guards and RLS. The service worker does not
   cache Supabase responses.
3. TanStack Query deduplicates requests in one browser tab, considers normal
   data fresh for two minutes, stops retrying deterministic 4xx failures, and
   removes inactive data after five minutes.
4. Leaderboards read small pages from internal materialized snapshots. Browsers
   cannot access the `reporting` schema directly.
5. Admin directories and review queues filter and paginate inside PostgreSQL;
   they no longer download the entire matching table to the browser.

Do not put authenticated responses, profile data, minors' data, signed storage
URLs or admin responses in Cloudflare Cache API/CDN cache. A shared cache key
mistake can expose one user's response to another user. Only add a shared edge
cache later for an explicitly public, sanitized endpoint with no cookies or
Authorization header and a carefully versioned cache key.

## Manual rollout order

Do not deploy the new frontend before its RPCs exist.

1. Take/confirm a current backup. Use staging first.
2. Run migration `083_security_query_guards.sql`.
3. Run migration `084_scalable_read_models.sql` outside a busy period. It builds
   the first materialized snapshots and their indexes.
4. Run migration `085_admin_review_queue_pages.sql`.
5. In Authentication > Multi-Factor, keep TOTP challenge and verification APIs
   enabled. Deploy the frontend containing `/admin-mfa`, then enroll and verify
   at least two owner/admin accounts so there is a tested recovery path.
6. Immediately run migration `086_admin_mfa_aal2.sql`. It intentionally blocks
   Admin 1, Admin 2 and Super Admin sessions from privileged data until the user
   completes `/admin-mfa`. Do not apply 086 before that route is deployed.
7. Run `supabase/AUDIT_migration_state.sql`; every 080-086 key gate must show
   `OK`.
8. In Supabase Cron, schedule
   `select public.refresh_leaderboard_snapshots();` every five minutes initially.
   Shorten to one minute only if product freshness requires it and refresh time,
   database CPU and I/O remain healthy. Do not schedule a second overlapping
   refresh job.
9. Smoke-test one account for each role, including a fresh admin AAL1 → AAL2
   challenge and an admin sign-out/sign-in.

## Supabase dashboard work (manual)

- Auth: turn off email auto-confirm, require email verification, set minimum
  password length to at least 8, configure production Site URL and exact redirect
  allow-list, and enable CAPTCHA/rate protections. Migration 086 and the
  `/admin-mfa` page enforce TOTP/AAL2 for application administrators; the
  Supabase organization/dashboard owners must separately enable MFA on their
  Supabase accounts and organization.
- Sessions: choose inactivity and absolute session timeouts appropriate for
  school/shared devices; verify sign-out revokes the expected sessions.
- Storage: keep proof photos, certifications and profile-change documents
  private. Set per-bucket MIME allow-lists and file-size limits. Verify the 083
  policies with an approved archer, coach, admin, pending user and anonymous user.
- Recovery/email: configure production SMTP, test password recovery, and monitor
  delivery/bounce limits.
- Backups: enable the backup/PITR level required by the recovery objective and
  perform a restore rehearsal before national rollout.
- Billing: configure spend notifications/budget controls where the plan supports
  them. Watch database CPU, memory, I/O, connections, API request count, egress,
  storage and function invocations.

## Phase 5: load testing and capacity decision

Phase 5 is operational proof, not another UI feature. It should be done after
083-085 are applied to a production-sized staging dataset.

1. Seed anonymized/synthetic data with realistic distributions and indexes.
2. Test login separately from steady authenticated reads; authentication rate
   limits and database capacity are different bottlenecks.
3. Ramp gradually (for example 100, 500, 1,000, 5,000 concurrent virtual users)
   instead of starting at 40,000. Stop when latency/error/CPU thresholds fail.
4. Model realistic behavior: dashboard open, leaderboard page one, a small
   percentage requesting later pages, and a much smaller admin workload. Do not
   model every user repeatedly polling every screen.
5. Record p50/p95/p99 latency, HTTP errors, Postgres CPU/I/O, active connections,
   cache hit ratios, slow queries, materialized-view refresh time and egress.
6. Use the measurements to choose Supabase compute size, pool/connection limits,
   refresh interval and whether a read replica or a sanitized edge endpoint is
   justified. Code alone cannot choose or guarantee those numbers.

Run load tests against staging or in an approved maintenance window. Never point
an unbounded test at the live project.

## Remaining follow-up before claiming full national-scale readiness

- Replace Admin 1 overview/state reports that still pull 5,000-10,000 raw rows
  with aggregate report RPCs.
- Paginate large coach-owned collections (archer roster, score history and
  achievement roster) and the Admin 2 audit/article/notification histories.
- Add server-side slow-query monitoring and an explain/analyze review using a
  production-sized staging dataset.
- Add an automated load-test scenario after staging credentials and test-data
  rules are agreed. Credentials must come from environment variables and must
  never be committed.
