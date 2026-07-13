# Production Readiness Checklist

_Final QA / security audit — 2026-07-01. EAD Archery Scene Monitor._

This is the go-live checklist. Items marked **⚠️ ACTION** require a manual step
before production. Items marked ✅ are verified in code.

---

## 0. Critical pre-launch actions (do these first)

1. **⚠️ Run migrations `031`, `032`, then `033` (in that order)** in the Supabase
   SQL Editor. They close database-layer gaps (see §3): self-promotion to Super
   Admin (031), audit-actor forgery + self field-locking (032), and score/cert/
   article/scope RLS (033). **Until they run, several escalation/forgery paths and
   broken coach flows remain.** Highest priority.
2. **⚠️ Run any not-yet-applied migrations** (this project applies them manually):
   `015`–`018`, `020`, `021`, `023`–`027`, `030`, `031`, `032`, `033`. In particular
   `017 PART 2`, `026`, `027`, `030`, `031`, `032`, `033` are security/feature-relevant.
3. **⚠️ Create the storage buckets** (Dashboard → Storage) — policies already
   exist (migration 007): `proof-photos` (private, 10 MB, image/*), `avatars`
   (public, 2 MB, image/*), `certifications` (private, 20 MB, pdf+image),
   `articles` (public, 10 MB, image/*), `branding` (public, 5 MB, image/*).
4. **⚠️ Add password-reset redirect URLs** (see §6).

---

## 1. Auth checklist

- ✅ Login / register / logout via `services/auth.ts` (`signInWithPassword`,
  `signUp`, `signOut`). Register is a mode on `/login` (no separate `/signup`).
- ✅ Approved/pending/rejected routing: `RequireAuth` redirects pending/rejected
  to `/pending`; approved users reach their role home.
- ✅ Forgot password (`/forgot-password`) → `supabase.auth.resetPasswordForEmail`
  with `redirectTo ${origin}/reset-password`. Always shows the same safe message
  (never reveals whether the email exists).
- ✅ Reset password (`/reset-password`, **unguarded** so the recovery session
  isn't redirected away) → `supabase.auth.updateUser({ password })`; invalid/
  expired link → "request a new link"; success → sign out → `/login`.
- ✅ Forgot email / account recovery (`/forgot-email`) → public insert only;
  safe success message; reveals nothing about account existence.
- ✅ No reset tokens are exposed in the UI; `detectSessionInUrl` handles them.
- ✅ Dev role-bypass on the login page is gated by `import.meta.env.DEV` (stripped
  from production builds).

## 2. Role checklist

- ✅ Route guards (`src/App.tsx`): `/archer` `[archer,super]`, `/coach`
  `[coach,super]`, `/admin1` `[admin1,super]`, `/admin2` `[admin2,super]`,
  `/super-admin` `[super]`. Lower roles are redirected to their own home.
- ✅ Static permission ceiling in `src/lib/permissions.ts`; dynamic DB layer in
  `services/rolePermissions.ts` with a safe fallback (a missing/failed fetch can
  never escalate a lower role — `SUPER_ADMIN_LOCKED_OFF_KEYS`).
- ✅ `/super-admin/role-permissions` is the **single editable** permission manager.
  `admin1-perms`/`admin2-perms` redirect to it; `super-admin/roles` + `admin2/roles`
  are read-only Role Overviews.
- ✅ Admin 2 cannot edit role permissions (route blocked + page guard + RLS
  `role_permissions_super_admin_all`).
- ✅ Admin 2 cannot manage Super Admin users (`canManageUserWithRole` →
  `canManageSuperAdminUsers`) — and now also at the DB layer after migration 031.
- ✅ Super Admin **Seed** (`/super-admin/seed`) is a read-only explainer — no
  navigation entry, no frontend role-promotion control. Seeding is manual SQL /
  service-role only.

## 3. RLS checklist

- ✅ RLS enabled on all app tables (migration 006). Helper fns
  `core.is_admin()` (admin2+super) and `core.is_super_admin()` both require
  `status='approved'`.
- ✅ `system.role_permissions` / `core.system_rules` / `core.app_config`: Super
  Admin write, Admin 2 read-only, public read of `is_public` rows only.
- ✅ Scores: archer own; coach linked-only; Admin 2 full; Admin 1 read.
- ✅ Coaching links / archer & coach profiles: own + linked + admin scoping.
- ✅ Audit logs: Admin 2 + Super Admin **read only**; insert only via the
  `log_audit` SECURITY DEFINER function; no update/delete (immutable).
- ✅ `support.account_recovery_requests`: anon **insert only**; SELECT/UPDATE
  restricted to `core.is_admin()`; **no public read**.
- **⚠️ FIXED IN 031 — was a real gap:** `core_profiles_own_update` allowed a user
  to change their **own** `role`/`status` (self-escalation to Super Admin) via a
  direct PATCH. `handle_new_user()` trusted sign-up metadata `role`. Migration 031
  adds a `BEFORE INSERT/UPDATE` guard trigger (own role/status immutable; self
  sign-up clamped to pending archer/coach) and re-asserts the Admin-2-vs-Super
  profile policies (017 PART 2). **Run 031 before launch.**

## 4. Storage checklist

- ✅ Buckets + policies defined (migration 007). Per-user folder scoping via
  `(storage.foldername(name))[1] = auth.uid()::text` → users cannot read/overwrite
  others' files.
- ✅ Private: `proof-photos` (owner + linked coach + admin), `certifications`
  (owner coach + admin). Public read: `avatars`, `articles`, `branding`.
- ✅ No anon write on any bucket. `branding` writes are Super-Admin only.
- ✅ Client-side type/size validation on uploads (e.g. branding: PNG/JPG/WEBP,
  5 MB, no SVG). Enforce bucket `allowed_mime_types` + size limit in the Dashboard
  when creating buckets (defense in depth).

## 5. Routes audit (intentional differences, not bugs)

- `/signup` → register mode on `/login`.
- `/archer/scores` → archers submit/view via the dashboard; no standalone route.
- `/{role}/articles` → shared `/articles` for everyone.
- `/admin1/dashboard` → `/admin1/overview`; `/admin2/dashboard` → `/admin2/centre`;
  `/super-admin/dashboard` → `/super-admin/settings`.
- `/super-admin/users|audit|change-requests` → Super Admin uses the `/admin2/*`
  pages (those routes allow `super_admin`).
- `/admin2/account-recovery` → **built** (recovery queue).

## 6. Redirect URL checklist (Supabase Dashboard → Authentication → URL Config)

Add to **Redirect URLs**:
- `http://localhost:5173/reset-password`  (local dev)
- `https://YOUR-DOMAIN.com/reset-password`  (production — your real domain)

Set **Site URL** to the production origin. The app uses `window.location.origin`
for `redirectTo`, so no domain is hardcoded.

## 7. Environment variable checklist

Required (client, `VITE_`-prefixed — safe to expose):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

- ✅ No service-role key in client code (`services/supabase.ts` uses the anon key
  only). No secrets hardcoded. Never put `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_`
  variable or any client file.

## 8. Dual-language

- ✅ Custom i18n (`src/i18n` + `LanguageContext` + `LanguageSwitcher`). Switcher
  works, persists in `localStorage` (`kpm.language.v2`), `ms → en → key` fallback.
- **Note / decision needed:** the **default language is currently English** (`en`)
  per an explicit request on 2026-07-01. The original spec wanted Bahasa Malaysia
  as default. If BM-default is desired for launch, change `DEFAULT_LANGUAGE` in
  `src/i18n/index.ts` back to `'ms'` (and optionally reorder the switcher). Left as
  English to honour the latest explicit instruction — confirm which you want.
- ✅ Translated: global nav (Header + BottomTabBar), account menu, role labels,
  shared states (AccessDenied/Feature/ComingSoon/Maintenance), auth recovery pages,
  Super Admin permission area, account-recovery admin queue.
- ◻️ **Remaining (non-blocking):** many role/admin page **bodies** still render
  English literals (fallback-safe). See `docs/i18n.md`.

## 9. Build

- ✅ `tsc --noEmit` passes. `vite build` passes (only the pre-existing >500 kB
  chunk-size warning for `TrendChart`/`index`). PWA service worker generated.

## 9b. Second audit pass — fixes applied (2026-07-01)

- ✅ **Certification column** standardized to `cert_url` (the real DB column,
  migration 005). The frontend previously used a non-existent `media_url`
  (`types/index.ts` + coach/admin Certifications pages) → certifications were
  broken against the real schema. Fixed in code (no migration needed).
- ✅ **Proof bucket** standardized to **`proof-photos`** everywhere (coach/admin
  Scores pages used a policy-less `proofs` bucket). Create the `proof-photos`
  bucket; the `proofs` bucket is no longer referenced.
- ✅ **Audit logging** — 7 direct `from('audit_logs').insert(...)` calls (coach
  Archers/ArcherDetail, admin2 Certifications) were silently failing (no INSERT
  policy) **and** passed a client-supplied `actor_id`. Replaced with the
  `writeAuditLog` RPC. Migration **032** hardens `log_audit` to take the actor from
  `auth.uid()` (unforgeable).
- ✅ **Profile self-field lock extended** (migration 032): a user cannot change
  role/status **or** approval/lifecycle/scope/coach-link fields on their own row.
- ⚠️ **Buckets to create** (Dashboard): `proof-photos`, `avatars`, `certifications`,
  `articles`, `branding`, `achievement-badges` (migration 012). Set MIME/size limits.
- ⚠️ **Open finding (needs your decision):** there is **no coach-write RLS policy**
  on `core.profiles`, so the coach "approve archer account" path (sets archer
  `status='approved'` + `coach_id`) is silently blocked by RLS (fails closed —
  safe, but the feature doesn't take effect). The coach-archer *link* approval
  works. Decide whether coaches should approve archer **accounts** (then add a
  tightly-scoped policy) or whether only admins approve accounts. Recommended
  scoped policy is in §10.

## 9c. Third audit pass — fixes applied (migration 033)

- ✅ **Coach score submission** now permitted by RLS: a new INSERT policy lets an
  approved coach insert a `coach_approved` score for a **linked** archer only
  (coach_id=self, no admin fields). Previously RLS silently blocked it.
- ✅ **Score escalation closed:** a `BEFORE INSERT/UPDATE` guard on
  `score_submissions` blocks non-admins from setting `status='admin_approved'` or
  changing `approved_by` / `admin_approved_at`. Archer/coach UPDATE `WITH CHECK`
  tightened to their real workflow statuses (the leaderboard counts only
  `admin_approved`, so this protects what's official).
- ✅ **Coach score withdraw** works: coach UPDATE policy now covers
  `pending`+`coach_approved` (approve/reject/withdraw); admin-approved rows are
  untouchable by coaches.
- ✅ **Certification upload path** fixed to `{coachId}/...` (was
  `coach-certifications/{coachId}/...`) so it satisfies the storage policy
  `foldername[1] = auth.uid()`.
- ✅ **Certification withdraw** is now a soft-delete (`status='withdrawn'`, the DB
  already allows it) instead of a DELETE that RLS blocked; no storage file is
  removed (no delete policy needed). Coach RLS lets them withdraw only their own
  pending/rejected certs and never self-approve.
- ✅ **Profile self-guard** now also locks Admin 1 scope fields (`scope_type`,
  `assigned_state_id/pld_id/school_id`) — a scoped Admin 1 cannot self-expand scope.
- ✅ **Article read RLS** now enforces `status='published'` AND `published_at<=now()`
  AND `audience IN ('all', <viewer role>)` — drafts/archived/foreign-audience
  articles are hidden at the DB, not just the UI.
- ⚠️ **Proof PDF:** set the `proof-photos` bucket allowed MIME types to
  `image/png, image/jpeg, image/webp, application/pdf` (the proof form accepts PDF).

## 10. Known TODOs / production hardening

- Account recovery public submit: add **CAPTCHA or server-side rate limiting**
  before public launch (anti-spam). No file uploads in that flow yet.
- Super Admin seeding: replace manual SQL with an **audited Edge Function** later.
- Achievement score thresholds seeded: 200/250/290/300/320/350. The audit spec
  also lists **310** and **330** — add achievement definitions if those tiers are
  wanted (content decision; not seeded today).
- **Coach-approves-archer account** (see §9b). If coaches SHOULD approve archer
  accounts, apply this tightly-scoped policy (a coach may flip ONLY a linked
  archer from pending→approved and set the coach link — nothing else). Review
  before running:
  ```sql
  -- OPTIONAL — only if coaches are meant to approve archer ACCOUNTS.
  CREATE POLICY "core_profiles_coach_approves_linked" ON core.profiles
    FOR UPDATE TO authenticated
    USING (
      core.current_role() = 'coach' AND core.is_approved()
      AND role = 'archer'
      AND EXISTS (SELECT 1 FROM coaching.coach_archer_links cal
                  WHERE cal.coach_id = auth.uid() AND cal.archer_id = core.profiles.id
                    AND cal.status = 'active')
    )
    WITH CHECK (
      core.current_role() = 'coach'
      AND role = 'archer' AND status IN ('pending','approved')
    );
  ```
  Otherwise, route archer-account approval through Admin 1 (scoped) / Admin 2.
- i18n: finish translating page bodies (mechanical; keys mostly exist).
- Code-splitting: consider `manualChunks` to shrink the main bundle (perf only).

## 11. Cloudflare deployment notes

- SPA on Cloudflare Pages: add an SPA fallback so deep links work — a
  `public/_redirects` containing `/*  /index.html  200` (BrowserRouter needs all
  paths served `index.html`; `/reset-password`, `/admin2/...` etc. must not 404).
- Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as build env vars in the
  Pages project. Build: `npm run build`, output dir: `dist`.
- Add the deployed origin to Supabase **Site URL** + **Redirect URLs** (§6).
- PWA: `dist/sw.js` is generated; ensure Pages serves it at the site root.
