# Admin Logic & Permission Foundation — Audit + TODO

Status snapshot from the **Admin Logic Audit / Permission Foundation** pass.
This is a developer reference only — it is **not** wired into the app UI.

Internal role values are fixed: `archer · coach · admin1 · admin2 · super_admin`.

---

## ✅ Completed in this pass

- **Centralised permission helpers** — `src/lib/permissions.ts`
  Pure, role-based functions (`canManageArticles`, `canAccessAdmin2`,
  `isSuperAdmin`, `canManageUserWithRole`, …). No React/Supabase deps, so
  usable in components, route guards and services.
- **Role config** — `src/lib/roleConfig.ts`
  Hierarchy, per-role home/redirect path, section→role access matrix,
  `getHomePath()`, `sectionForPath()`.
- **AccessDenied component** — `src/components/common/AccessDenied.tsx`
  Friendly "Access Denied" screen with *Go to my dashboard* + *Go back*.
- **Route guard consolidation** — `src/App.tsx`
  Removed the duplicated `getHomePath` map (now imported from `lib`).
  `RequireAuth` gained an opt-in `onDenied="deny"` mode that renders
  `<AccessDenied/>` instead of redirecting (default stays `redirect`, so no
  existing behaviour changed).
- **Header consolidation** — `src/components/layout/Header.tsx`
  Removed its private `getDefaultPath` copy; now uses `getHomePath` from `lib`.
- **Article pages use helpers** — `Articles.tsx`, `ArticleDetail.tsx`
  Inline `role === 'admin2' || role === 'super_admin'` replaced with
  `canManageArticles(role)`.
- **Article service guards** — `src/services/articles.ts`
  `createArticle` / `updateArticle` / `deleteArticle` now call
  `assertCanManageArticles()` (reads role from the auth store) for fast,
  friendly failure. RLS `articles_admin2_full` is still the real guard.

### Verified already-correct (left untouched)
- **Route protection** in `App.tsx` already gates every section with
  `allowedRoles` (each includes `super_admin`), redirects logged-out → `/login`,
  pending/rejected → `/pending`, and role-mismatch → own dashboard.
- **Navigation** (`Header.tsx` `NAV_ITEMS`, `BottomTabBar.tsx` `TABS`) is fully
  role-filtered; no menu item points at a section the role cannot open.
- **RLS** (`006_rls_api_views.sql`) is sound and matches the frontend model:
  `core.is_admin()` = `admin2 + super_admin`, `core.is_super_admin()` =
  `super_admin`. Content/org writes require `is_admin`; role-permissions &
  system rules require `is_super_admin`.

---

## 🔶 Admin 1 scope logic (approval WRITE scoped; READ still national)

**Scope model — built** (Admin 1 Approval Center pass). Migration `018`
added `assigned_state_id` / `assigned_pld_id` / `assigned_school_id` /
`scope_type` to `core.profiles`, plus `core.admin1_in_scope()` and the scoped
UPDATE policy `core_profiles_admin1_approve_in_scope`. Effective scope =
explicit assignment → else derived from the admin's own location → else none
(default deny). Logic lives in `src/lib/scope.ts` (mirrored exactly by the SQL
function). `/admin1/approvals` (`src/pages/admin1/Approvals.tsx`) +
`src/services/approvals.ts` use it to scope approve/reject. `canApproveRegistrations`
now includes `admin1`.

Still open:
- [ ] **READ is still national.** `core_profiles_admin1_read_all` is kept so the
      Overview page and the read-only "Outside scope" tab work. The Approval
      Center filters to scope on the client; the WRITE is the hard boundary
      (RLS + service). Tighten READ later only if national visibility is a concern.
- [ ] **Archer extension fields** (`age_group` / `dominant_hand`) aren't readable
      by admin1 (no scoped SELECT policy on `coaching.archer_profiles`); the page
      shows `bow_category`/`age` from `core.profiles` instead. Add a scoped
      `archer_profiles` SELECT policy if those fields are needed in-scope.
- [ ] **Explicit scope assignment UI** — Admin 2 user management can already edit
      org location but not the `assigned_*`/`scope_type` fields. Add scope-assignment
      controls there so admins get explicit (not just derived) scope.
- [ ] Decide whether admin1 may create **scoped** notifications/articles vs only
      **global** ones (currently `canManageNotifications` allows admin1; articles
      are admin2+ only).

---

## 🔶 Admin 2 controls (foundation ready, pages pending)

- [x] **User management page** — **built** (User Management pass). `/admin2/users`
      now does view/search/filter, approve/reject/suspend/reactivate, edit
      (name/status/role/org/notes), role change (confirm + super_admin-capped),
      org assignment (cascading state→PLD→school) and coach-archer link/unlink.
      Guarded by `canManageUsers` + `<AccessDenied>`; every action re-reads the
      target's role server-side via `canManageUserWithRole`, so admin2 can never
      touch a `super_admin`. Service `src/services/users.ts`; migration
      `017_user_management.sql` (**run manually** — adds reject/suspend columns +
      `admin_notes`, refreshes `public.profiles`, and PART 2 hardens profile RLS).
- [ ] Confirm `/admin2/roles` (`Admin2Roles`) is **view-only** for admin2 —
      `canManageRolePermissions` is `super_admin`-only.
- [ ] Apply `canManageAchievements` / `canManageNotifications` /
      `canViewAuditLogs` to the relevant admin2 action buttons (currently gated
      only by route + RLS — safe, but should use helpers for consistency).

---

## 🔶 Super Admin controls (foundation ready, pages pending)

Foundation in place; remaining super-admin pages:
- [x] `/super-admin/system-rules` → **built** (System Rules pass). Gated with
      `canManageSystemRules`; super-admin-only via RLS + AccessDenied.
- [x] `/super-admin/role-permissions` → **built** (Role Permissions pass).
      New `system.role_permissions` table (migration `016`) — chosen to avoid
      collision with the legacy `core.permission_rules` / `core.role_permissions`.
      Gated with `canManageRolePermissions`; dynamic layer = `hasRolePermission()`.
- [ ] `/super-admin/roles` + `admin1-perms` + `admin2-perms` are still
      `ComingSoonPage` — fold them into, or link them to, the new role-permissions
      page (they overlap conceptually).

---

## 🔶 RLS checks / awareness

No migration was created — **nothing here breaks the app today.** Note for later:

1. **Article audience is a soft filter, not a hard boundary.** RLS
   `articles_approved_read_published` lets *any approved user* read *any*
   published article regardless of `audience`. The frontend filters by audience
   for UX only. Acceptable for non-sensitive content; revisit if articles ever
   carry private/targeted info.
2. **Archived articles remain readable via RLS** — the read policy checks
   `published_at`, not `status`. The frontend hides them (`status='published'`),
   but a direct query could see a once-published, now-archived row. Low risk.
3. **Admin1 reads are unscoped** (see Admin 1 section) — the main RLS item to
   address when scope ships.

If/when these are tightened, add a focused migration; do **not** rewrite the
existing safe policies wholesale, and do **not** grant `anon` access.

---

## 🔶 Audit log gaps

`writeAuditLog(actorId, action, targetType, targetId, meta)` (RPC `log_audit`)
is already called for achievements, notifications, articles, profile-change
requests. Add when the corresponding pages are built:
- [ ] `achievement.activated` / `achievement.deactivated` (currently only
      created/updated are logged).
- [ ] `notification.scheduled` (created/updated/published/archived/deleted exist).
- [x] `user.approved` / `user.rejected` / `user.suspended` / `user.reactivated` /
      `user.updated` / `user.role_changed` / `user.organization_assigned` +
      `coach_archer_link.created` / `coach_archer_link.removed` — **done**
      (User Management pass; all via `writeAuditLog` RPC, not direct inserts).
- [x] `user.approved_by_admin1` / `user.rejected_by_admin1` /
      `approval.scope_denied` / `approval.viewed_details` — **done**
      (Admin 1 Approval Center pass).
- [x] `system_rule.created/updated/deleted/restored_missing_defaults` +
      `system_rule.maintenance_enabled/disabled` — **done** (System Rules pass).
- [x] `role_permission.created/updated/enabled/disabled/bulk_updated/`
      `reset_to_default/restored_missing_defaults` — **done** (Role Permissions pass).

---

## 🔶 Feature flags (System Rules pass)

`system_rules` table + `public.system_rules` view added (migration
`015_system_rules.sql`). Feature flags are read via `useRuleValue(key, fallback)`
(`src/hooks/useSystemRules.ts`), always with a safe fallback.

Integrated so far:
- [x] `maintenance_mode` → `AppLayout` (global; admin2/super bypass).
- [x] `module_articles_enabled` → `/articles` (super bypass).
- [x] `module_achievements_enabled` → archer + coach achievements (admin2/super bypass).
- [x] `module_notifications_enabled` → archer + coach + admin1 notifications (admin2/super bypass).

Remaining (same one-line `useRuleValue` + `FeatureUnavailable` pattern):
- [ ] `module_equipment_enabled` → equipment pages.
- [ ] `module_reports_enabled` → reports dashboard (when built).
- [ ] `module_leaderboard_enabled` / `leaderboard_*` → leaderboard.
- [ ] Wire operational rules (score submission/validation, registration approval)
      into their flows — these are seeded but not yet enforced in the UI/RLS.

---

## 🔶 Role permissions (Role Permissions pass)

`system.role_permissions` table + `public.role_permissions` view (migration
`016_role_permissions.sql`). Dynamic checks via `hasRolePermission(role, key,
map, fallback)` (`src/lib/permissions.ts`) and `useHasPermission(role, key,
fallback)` (`src/hooks/useRolePermissions.ts`). Always pass a static fallback.

Safety floor: `SUPER_ADMIN_LOCKED_OFF_KEYS` — lower roles can NEVER hold these,
even on a failed/missing fetch.

Integrated so far:
- [x] Article viewer edit link → `useHasPermission(role, 'edit_article', canManageArticles(role))`.

Remaining light integrations (additive layer, keep static fallback — **do not
replace** existing checks):
- [ ] Admin 2 Articles Manager buttons (`create/edit/publish/archive/delete/duplicate_article`).
- [ ] Admin 2 Notification Manager buttons (`create/publish/archive/delete_notification`).
- [ ] Admin 2 Achievement Manager buttons (`create/edit/activate/deactivate_achievement_definition`).
- [ ] Navigation visibility + page-access guards (use `access_*` keys as an
      additional layer on top of the existing route `allowedRoles`).
- [ ] Deeper enforcement in user management, scores, reports, approval flows.

---

## 🚫 Deliberately NOT built this pass

Equipment pages · Reports dashboard · Score-approval scoping for Admin 1 ·
Dual-language (i18n) UI. The permission foundation above is ready for each.

### Follow-ups left by the User Management pass
- [ ] **Org management UI** — admin2 can *assign* state/PLD/school but cannot
      *create* them. A schools/PLDs/states CRUD page is still missing
      (`canManageSchools/PLDs/States` exist). Edit modal shows an empty-state
      hint when no schools exist.
- [ ] **Admin 1 approval scope** — admin2 user mgmt is national. When admin1
      scope ships (see Admin 1 section), add a scoped Admin 1 approval view that
      filters `getUsersAdmin()` by the admin's `state_id`/`pld_id`.
- [ ] **Server-side pagination** — `getUsersAdmin()` loads all visible profiles
      and filters client-side. Fine at current scale; add range pagination if a
      state ever exceeds ~1000 users (PostgREST default cap).
- [ ] **Deeper RLS** — migration 017 PART 2 (split profile policy so admin2
      can't read/write super_admin) is **recommended but separable**; the app
      already blocks it in service + UI. Run PART 2 for defence-in-depth.
