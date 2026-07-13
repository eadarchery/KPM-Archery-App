# Launch Readiness Checklist — High-Priority Items

Status date: 2026-07-05. Code for all four items is implemented and building.
Items 1, 2 and 4 each have **one migration to run manually** (055, 056, 057) plus,
for item 1, **Supabase Dashboard settings** that only the project owner can set.

| # | Item | Priority | Owner | Code | SQL to run | Dashboard setup |
|---|------|----------|-------|------|-----------|-----------------|
| 1 | Account recovery protection | High | Developer / Supabase | ✅ | migration **055** | CAPTCHA + Auth rate limits (below) |
| 2 | Official coach approval model | High | Product Owner / Developer | ✅ (approve existed; reject added) | migration **056** | — |
| 3 | Launch test pack | High | Trainer / Admin 2 | ✅ docs + seed | `seeds/launch_test_pack.sql` | create 7 auth users |
| 4 | Coach updates archer equipment | High | Developer / Coach Module Owner | ✅ (was built, disabled) | migration **057** | — |

---

## 1. Public account recovery protection

- **Affected pages:** `/forgot-password`, `/forgot-email`, `/login` (register+signin), `src/components/auth/CaptchaWidget.tsx`, `src/hooks/useCooldown.ts`, `services/auth.ts`
- **What shipped (app):**
  - **CAPTCHA (Cloudflare Turnstile)** — optional, activated by setting `VITE_TURNSTILE_SITE_KEY` at build time. Wired into forgot-password, login and register (Supabase Auth CAPTCHA is project-wide, so login/register must send tokens too once enabled). Widget renders in the user's language (EN/BM).
  - **Device cooldowns** — 60s on forgot-password, 120s on forgot-email (persist across refresh).
  - **Friendly bilingual messages** — request submitted (neutral: *"If an account exists…"*, unchanged), too many attempts, CAPTCHA required/failed, generic failure. Raw auth errors are never shown; account existence is never revealed.
- **What shipped (DB): migration 055** — rate-limit trigger on the public forgot-email table: 3/hour + 10/day per client IP (x-forwarded-for) and 30/hour global circuit breaker; stores `request_ip` for admin abuse review (admin-only SELECT, anon can never read back).
- **Supabase Dashboard setup (project owner — cannot be done from SQL):**
  1. *Auth → Attack protection → CAPTCHA*: enable, provider **Turnstile**, paste the secret key. Then set `VITE_TURNSTILE_SITE_KEY` in the build env and redeploy. ⚠ Do not enable the Dashboard side without deploying the built-in widget first — auth calls without tokens are rejected.
  2. *Auth → Rate limits*: confirm/lower "emails sent per hour" and token-related limits to taste (defaults exist; recommended ≤ 4 recovery emails/hour/user).
  3. *Auth → SMTP*: production sender configured so recovery mail is deliverable.
- **DB impact:** one column + trigger + 2 indexes on `support.account_recovery_requests`. **RLS impact:** none (trigger is SECURITY DEFINER; policies unchanged).
- **i18n impact:** `auth.captcha.*`, `auth.forgotPassword.tooManyAttempts/waitCooldown` (EN+BM done).
- **Testing:** submit forgot-password twice fast → cooldown message; 429/limit from Supabase → "too many attempts"; forgot-email 4× within an hour from one IP → blocked with friendly message; success path unchanged and identical for existing vs unknown emails.
- **Pass:** spam bursts blocked at server; no message ever confirms an account exists. **Fail:** any raw error text or unlimited repeat submissions.

## 2. Official coach approval model

- **Already existed (migration 034):** archer registers with school code → pending → only APPROVED coaches of that school see them → approve activates account, sets school/PLD/state, links coach, audit-logs. Scope is enforced inside SECURITY DEFINER RPCs — coaches cannot touch other schools, PLDs or states.
- **What shipped now:**
  - **Migration 056:** `coach_reject_archer(id, reason)` RPC with identical scope checks; stores `rejection_reason`, clears the requested school, audit-logs `coach.archer_registration_rejected`. Also lets a rejected archer re-claim a *correct* code (returns to pending — never to approved).
  - **UI:** Reject button + reason modal beside Approve in the coach queue ([Archers.tsx](../src/pages/coach/Archers.tsx)); queue header now has a "?" help tip explaining exactly what approval does, who it affects, reversibility and a warning (`helpTips.coachApproval`, EN+BM).
  - Admin oversight unchanged: Admin 1 Approval Center, Admin 2 User Manager overrides, and every decision in the audit log viewer.
- **DB impact:** 2 functions (1 new, 1 amended). **RLS impact:** none (RPC-centric by design). **Role permissions:** no change needed — approval rights derive from being an approved coach *of that school*, enforced server-side.
- **i18n impact:** `coachArchers.schoolRegQueueTitle/RegRejected/rejectReg*`, `helpTips.coachApproval.*` (EN+BM done).
- **Testing:** matrix in [launch-test-pack.md](launch-test-pack.md) §D — includes cross-school negative tests for every role and the pending-gate check.
- **Pass:** coach can approve/reject only own-school pending archers; both actions audited; pending archers blocked from approved-only features. **Fail:** any cross-scope approval succeeding.

## 3. Launch test pack

- **Deliverables:** [launch-test-pack.md](launch-test-pack.md) (accounts table, per-account notes, trainer checklist, pass/fail criteria) + [seeds/launch_test_pack.sql](../supabase/seeds/launch_test_pack.sql).
- 7 accounts (no Super Admin): archer, coach, and — since school/PLD/state admins are Admin 1 scopes in this app — three single-scope Admin 1s, one multi-scope Admin 1, one Admin 2. All inside `_TEST State/PLD/School` marker entities with `@asm-test.example` emails.
- **Safety:** no real student data; passwords created only in the Dashboard and kept in the tester's password manager; clean-up section included.
- **DB impact:** test rows only (idempotent, removable). **RLS impact:** none. **i18n impact:** none (docs).
- **Pass:** every checklist box ticked in EN and BM; all "must fail" actions fail.

## 4. Coaches update linked archers' equipment

- **Already existed (migration 020, shipped disabled):** full field set (bow category, riser, limbs, poundage/draw, string, arrows/spine/point, sight, stabilizer, clicker/plunger/rest, scope/peep/release, tab, notes…), one profile per archer, `updated_by` stamping, coach RLS **limited to active coach_archer_links** and gated by the `coaches_can_edit_archer_equipment` system rule, role-permission key, audited service (`equipment.coach_updated`), and the coach Equipment page with view/edit popup already permission-gated.
- **What shipped now:**
  - **Migration 057:** flips the two switches ON — system rule `coaches_can_edit_archer_equipment` → true and coach role permission `edit_linked_archer_equipment` → enabled. Super Admin can turn the rule off anytime; RLS reads it live.
  - **UI:** "Last updated {date} by {name}" line in the equipment popup (self / archer / admin attribution) + "?" help tip explaining that equipment data is used for coaching, reports and archer tracking (`helpTips.coachEquipment`, EN+BM).
- **Permission matrix (unchanged, now active):** archer = view/edit own · coach = view/edit **linked only** (RLS-enforced) · Admin 1 = view within scope · Admin 2/SA = view/edit all.
- **DB impact:** 2 UPDATE statements. **RLS impact:** none new — pre-existing policies simply start passing.
- **i18n impact:** `equipment.lastUpdatedLine/updatedByAdmin`, `helpTips.coachEquipment.*` (EN+BM done).
- **Testing:** [launch-test-pack.md](launch-test-pack.md) §F — linked-edit succeeds, unlinked-edit read-only, persistence, BM, mobile.
- **Pass:** coach edits linked archers only; every save shows attribution and lands in the audit log. **Fail:** any edit on an unlinked archer.

---

## Run order (SQL Editor)

1. `055_account_recovery_rate_limit.sql`
2. `056_coach_reject_archer.sql`
3. `057_enable_coach_equipment_edit.sql`
4. (when testing) `seeds/launch_test_pack.sql` — after creating the 7 Dashboard users

Then complete the Dashboard steps in item 1 and run the full test pack before real schools join.
