# Launch Test Pack — KPM / EAD Archery App

One test account per role, plus a step-by-step checklist for trainers and Admin 2
users. Setup: [supabase/seeds/launch_test_pack.sql](../supabase/seeds/launch_test_pack.sql)
(2 steps: create the 7 auth users in the Dashboard, then run the seed).

**Rules**
- **No real student data.** All test people are named `TEST …` and live in the
  clearly-marked `_TEST State (ZZT)` → `_TEST PLD (ZZTP)` → `_TEST School (ZZTS1)`.
- **Passwords are never stored in the app, this repo, or shared docs** — keep them
  in the tester's own password manager; reset via /forgot-password when needed.
- No Super Admin account in this pack (deliberate).
- Note: in this app, "School Admin", "PLD" and "State Admin" are **Admin 1**
  accounts with a school / PLD / state scope respectively (there is no separate
  role — scope comes from the Admin 1 scope table).

## The 7 accounts

| # | Login (email) | Role | Scope / org | Status | Expected dashboard | Key restricted actions (must FAIL) |
|---|---------------|------|-------------|--------|--------------------|------------------------------------|
| 1 | test.archer@asm-test.example | Archer | _TEST School; linked to TEST Coach | approved | Archer dashboard: scores, achievements, equipment, articles | Cannot see other archers' data; cannot approve anything; cannot open /admin1/* /admin2/* routes; cannot change own status/school |
| 2 | test.coach@asm-test.example | Coach | _TEST School | approved | Coach dashboard: students, validation queue, rounds, equipment | Cannot approve archers of OTHER schools; cannot validate outside links; cannot open admin routes |
| 3 | test.admin1.school@asm-test.example | Admin 1 ("School Admin") | school = _TEST School | approved | Admin 1 overview + Approval Center + Reports limited to the school | Sees ONLY _TEST School data; cannot see other schools/PLDs/states; no user-role editing |
| 4 | test.admin1.pld@asm-test.example | Admin 1 ("PLD") | pld = _TEST PLD | approved | Same pages scoped to the PLD | Sees only PLD's schools; no national data |
| 5 | test.admin1.state@asm-test.example | Admin 1 ("State Admin") | state = _TEST State | approved | Same pages scoped to the state; State Report PDF | Sees only the state; no national data |
| 6 | test.admin1.multi@asm-test.example | Admin 1 | all three scopes (tests the scope switcher) | approved | Scope dropdown offers state/PLD/school | Data always matches the selected scope |
| 7 | test.admin2@asm-test.example | Admin 2 | national | approved | Control Centre: users, scores, org, reports, audit, recovery | Cannot edit role permissions (read-only manager); cannot access /super-admin/* editors |

## Test notes per account

- **Archer (1):** submit a training score → it must appear in Coach (2)'s validation
  queue, not be auto-approved. Check equipment page is editable by self.
- **Coach (2):** approve/reject flows below; equipment of linked archer editable
  (after migration 057); MyPerformance and certifications pages open.
- **Admin1 school/pld/state (3–5):** on /admin1/approvals and /admin1/reports the
  scope banner must name exactly their assigned entity.
- **Admin1 multi (6):** the scope selector shows 3 entries; switching changes data.
- **Admin2 (7):** Score Validator only shows coach-approved scores; audit log lists
  every action performed during this test run.

## Trainer / Admin 2 testing checklist

Work top-to-bottom **twice**: once in English, once in Bahasa Malaysia
(account menu → Language). Tick per account where relevant.

**A. Access & session**
- [ ] Login succeeds for each account; logout returns to /login
- [ ] Password recovery: /forgot-password sends reset (same neutral message whether or not email exists); repeated submits hit the cooldown / "too many attempts" message
- [ ] /forgot-email submits once, then cooldown; 4th rapid attempt from the same network is blocked (migration 055)
- [ ] Wrong password shows a friendly error; no raw Supabase text

**B. UI & accessibility**
- [ ] Language switch EN ⇄ BM updates all chrome and page bodies
- [ ] Font size: all 5 sizes apply and persist after refresh + relogin (account menu)
- [ ] Onboarding tour appears on first login per account, is skippable, replayable from account menu
- [ ] Mobile (or a narrow window): bottom tabs, tables scroll, modals usable

**C. Navigation & permissions (per account)**
- [ ] Menu shows only that role's entries; deep-linking a forbidden route shows Access Denied
- [ ] Archer cannot read another archer's profile/scores via URL (RLS check)
- [ ] Admin 1 accounts see ONLY their scope's data on approvals + reports (RLS check)

**D. Coach approval flow (core launch flow)**
- [ ] Register a NEW archer with _TEST School's code (Schools page shows the code for the coach) → account lands as "pending"
- [ ] Pending archer sees the pending gate — no approved-only features
- [ ] Coach (2) sees them in the school-code queue with the "?" help tip
- [ ] Approve → archer becomes active, linked to coach, appears in student list; audit log entry `coach.archer_approved`
- [ ] Register another archer → Reject with reason → account inactive, reason stored; audit `coach.archer_registration_rejected`; archer can re-register with correct code
- [ ] Coach CANNOT see/approve a pending archer of a different school (create one via a second school code to verify — expect empty queue)
- [ ] Admin 2 sees both decisions in /admin2/audit

**E. Coach–archer linking**
- [ ] Link an existing archer by Archer ID; unlink; re-link — audit entries present

**F. Equipment (item 4)**
- [ ] Coach edits linked archer's equipment → saves; "Last updated … by …" line updates
- [ ] Coach CANNOT edit an unlinked archer (read-only chip shows)
- [ ] Archer sees own equipment; Admin 2 can view/edit any
- [ ] Changes persist after refresh; works in BM; works on mobile

**G. Reports & exports**
- [ ] Admin 1 (each scope) and Admin 2 reports load with filters
- [ ] "Print / Save as PDF" produces branded header (title, date, range, filters, prepared-by)
- [ ] CSV export works (Admin 2); import templates & guide open on Schools page

**H. Admin controls**
- [ ] Admin 2 user manager: role/status changes show help tips and are audited
- [ ] Score Validator approve/reject with reason works; leaderboard updates only on approval

## Pass/fail criteria

**PASS** = every box ticked in both languages, and **all "must FAIL" actions in the
account table actually fail** (Access Denied / empty scope / RLS error — never data).
Any restricted action that *succeeds* is a launch blocker: stop and report it with
the account, URL, and screenshot before onboarding real schools.
