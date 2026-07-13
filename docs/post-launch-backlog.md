# Post-Launch Readiness Backlog — KPM / EAD Archery App

Status date: 2026-07-05. All five items below are **implemented** in this codebase.
Nothing was removed or rebuilt — every change is additive on top of existing working pages.
All new UI text ships in **English + Bahasa Malaysia** from day one.

| # | Item | Priority | Owner | Status |
|---|------|----------|-------|--------|
| 1 | In-app help tips for complex admin pages | Medium | Frontend | ✅ Done |
| 2 | Import templates & validation guide | Medium | Frontend + Docs | ✅ Done |
| 3 | Report PDF export (Admin 1 + Admin 2) | Medium | Frontend | ✅ Done |
| 4 | Font size adjuster: Extra Large + Max | Medium | Frontend | ✅ Done |
| 5 | First-login onboarding walkthrough | Low | Frontend | ✅ Done |

---

## 1. In-app help tips (admin usability)

- **Priority:** Medium · **Owner:** Frontend
- **What shipped:** Reusable `HelpTip` component (`src/components/ui/HelpTip.tsx`) — a "?" button
  with a structured popover: *What this does / Who it affects / Reversible? / ⚠ Warning*.
- **Affected pages/modules:**
  - `admin2/Users.tsx` — role change, status change, Admin 1 scope
  - `admin1/Approvals.tsx` — approval queue scope
  - `admin2/Achievements.tsx` — recheck badges
  - `superadmin/SystemRules.tsx` — system rules page (per-rule popovers already existed)
  - `superadmin/RolePermissions.tsx` — bulk permission actions
  - `admin2/Reports.tsx` + `admin1/Reports.tsx` — export scope / report scope
- **Database impact:** none. **RLS impact:** none.
- **i18n impact:** new `helpTips.*` group (labels + 9 structured entries), EN + BM.
- **Testing checklist:**
  - [ ] Each "?" opens on hover and on tap (mobile), closes on Escape / outside click
  - [ ] Warning row renders in warning tone where defined (role change, system rules)
  - [ ] Copy correct in both EN and BM (switch language, reopen tips)
  - [ ] No layout shift on pages where tips were added

## 2. Import templates & validation guide (KPM-scale onboarding)

- **Priority:** Medium · **Owner:** Frontend + Docs
- **What shipped:**
  - Template generators in `src/services/excel.ts`: `downloadSchoolTemplate` (existing),
    plus new `downloadCoachTemplate`, `downloadArcherTemplate`, `downloadAdminTemplate`
    (each with header row + realistic example row; stable English snake_case columns so
    files work regardless of UI language).
  - `ImportGuideModal` (`src/components/forms/ImportGuideModal.tsx`): before-you-upload
    checklist, 4 template tabs, and per-template **required fields / optional fields /
    accepted formats / validation rules / duplicate handling / error guidance**.
  - Entry point: **“Import templates & guide”** button on `admin2/Schools.tsx`.
- **Database impact:** none (schools import uses the existing path; coach/archer/admin
  templates are onboarding-prep documents — accounts still register via school code or
  are created by admins, as stated in the guide's footer note).
- **RLS impact:** none.
- **i18n impact:** new `importGuide.*` group (~40 keys), EN + BM.
- **Testing checklist:**
  - [ ] All four templates download and open in Excel with header + example row
  - [ ] Guide tab content matches each template's columns
  - [ ] Existing school Excel import still works unchanged
  - [ ] Modal is scrollable and usable on mobile

## 3. Report PDF export (Admin 1 + Admin 2)

- **Priority:** Medium · **Owner:** Frontend
- **What shipped:** `ReportPrintShell` (`src/components/reports/ReportPrintShell.tsx`) —
  print-isolation CSS (proven StateReport pattern, no new dependency) plus a print-only
  header (**brand name, report title, generated timestamp, date range, filters used,
  prepared-by name + role**) and a print-only branded footer. `PrintReportButton`
  triggers `window.print()` → "Save as PDF".
- **Affected pages/modules:** `admin2/Reports.tsx` (national) and `admin1/Reports.tsx`
  (scoped) — report body wrapped in the shell; button added beside existing actions.
  `admin1/StateReport.tsx` already had its own print layout and is untouched.
- **Database impact:** none. **RLS impact:** none (prints exactly what the admin can
  already see; Admin 1 scope resolution unchanged).
- **i18n impact:** new `reportPdf.*` group (7 keys), EN + BM. Printed labels follow the
  admin's current language.
- **Testing checklist:**
  - [ ] Print preview shows only the report (no nav/filters/buttons) on both pages
  - [ ] Header shows correct title, timestamp, date-range label and filter summary
  - [ ] Prepared-by shows the logged-in admin's name and translated role
  - [ ] Charts (SVG) and tables render in the PDF; summary cards lay out acceptably
  - [ ] Existing filters and CSV export unchanged
  - [ ] Repeat in BM — all printed labels translated

## 4. Font size adjuster — Extra Large + Max (accessibility)

- **Priority:** Medium · **Owner:** Frontend
- **What shipped:** `FontSize` type extended with `'xl' | 'max'`; CSS scales
  `--font-scale: 1.24` / `1.4` in `globals.css`; header segmented control now
  Small → Normal → Large → Extra Large → Max; same 5-option row added to the account
  dropdown (`FontSizeMenuRow`) so mobile/tablet users can reach it.
- **Persistence:** unchanged existing chain — zustand `persist` (localStorage
  `asm-ui-prefs`) → `data-font-size` attribute → `--font-scale` → root `font-size`.
  Survives refresh, logout and next login on the same device.
- **Affected pages/modules:** `types/index.ts`, `styles/globals.css`,
  `components/layout/Header.tsx`. `store/uiStore.ts` needed no change.
- **Database impact:** none. **RLS impact:** none.
- **i18n impact:** `fontSize.*` group (xl = "Extra Large" / "Sangat Besar",
  max = "Max" / "Maksimum"), EN + BM.
- **Testing checklist:**
  - [ ] Each size applies instantly app-wide and persists across refresh + logout/login
  - [ ] At Max: dashboards, tables (horizontal scroll ok), forms, charts and mobile
        layouts remain usable — no clipped controls
  - [ ] Selector reachable on mobile via account menu
  - [ ] Labels correct in EN and BM

## 5. First-login onboarding walkthrough (training readiness)

- **Priority:** Low · **Owner:** Frontend
- **What shipped:** `OnboardingTour` (`src/components/onboarding/OnboardingTour.tsx`)
  mounted in `AppLayout`; small non-persisted `onboardingStore`.
  - **Per-role step decks:** archer (7), coach (7), admin1 (5), admin2 (6),
    super_admin (5) — covering dashboard, profile, score submission, validation/approval
    flow, reports, help, and role-specific actions.
  - **First-time only:** auto-opens when `asm-onboarding-v1:<userId>` is absent in
    localStorage; records `done` / `skipped`.
  - **Skippable & completable:** Skip link, Escape key, Back/Next, Done.
  - **Reopenable:** account menu → **"App tour" / "Lawatan aplikasi"**.
- **Database impact:** none (device-local flag; a future enhancement could move the
  completion flag into `profiles` for cross-device memory). **RLS impact:** none.
- **i18n impact:** new `onboarding.*` group (~70 keys), EN + BM.
- **Testing checklist:**
  - [ ] Fresh user (or cleared localStorage) sees the tour once after login
  - [ ] Correct step deck per role; dots/Back/Next/Done navigation works
  - [ ] Skip and Escape both dismiss and never auto-show again
  - [ ] "App tour" menu entry replays the tour from step 1
  - [ ] Content correct in both languages; usable on mobile

---

## Cross-cutting verification

- [ ] `tsc --noEmit` clean (run via `node .\node_modules\typescript\bin\tsc --noEmit` — `&` in path breaks npm scripts)
- [ ] `vite build` clean (run via `node .\node_modules\vite\bin\vite.js build`)
- [ ] No migration required for any item; no RLS policy touched
- [ ] EN/BM parity: every new key exists in both `src/i18n/en.ts` and `src/i18n/ms.ts`
