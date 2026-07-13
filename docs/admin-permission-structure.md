# Admin & Permission Structure

_Last updated: 2026-06-30 — Permission / Redundant Pages Cleanup._

This document is the reference for how role permissions are structured in the app
and which pages own which responsibility. It exists so the permission surface stays
**one clear structure** and is never duplicated again.

---

## The single editable permission manager

**`/super-admin/role-permissions`** (`src/pages/superadmin/RolePermissions.tsx`) is the
**one and only** place where role permissions are edited.

- Super Admin only — view and edit. Enforced at three layers:
  1. Route guard: the `/super-admin` parent route allows `['super_admin']` only.
  2. Page guard: `canManageRolePermissions(role)` → `AccessDenied` otherwise.
  3. Database: `system.role_permissions` RLS policy `role_permissions_super_admin_all`
     gates all writes behind `core.is_super_admin()`.
- Edits all five roles in one place via role tabs: **Archer, Coach, Admin 1, Admin 2, Super Admin**
  (`ASSIGNABLE_ROLES` in `src/services/rolePermissions.ts`).
- Deep-linkable per role: `/super-admin/role-permissions?role=admin1` opens the Admin 1 tab.
- Dangerous permissions require a confirm step (`DANGEROUS_PERMISSION_KEYS`).
- Locked permissions cannot be toggled (`locked` rows; service throws on locked update).
- Super-Admin-only keys can never be enabled for lower roles
  (`SUPER_ADMIN_LOCKED_OFF_KEYS` in `src/lib/permissions.ts`; also forced off in the
  DB seed and `defaultForPermission()`).

There are **no** separate editable permission pages. Do not create per-role editors.

---

## What happened to the redundant pages

| Route | Before | After |
|-------|--------|-------|
| `/super-admin/role-permissions` | Editable manager | **Kept — the single editable manager** |
| `/super-admin/admin1-perms` | Coming-soon placeholder | **Redirect** → `/super-admin/role-permissions?role=admin1` |
| `/super-admin/admin2-perms` | Coming-soon placeholder | **Redirect** → `/super-admin/role-permissions?role=admin2` |
| `/super-admin/roles` | Coming-soon placeholder | **Read-only Role Overview** (with a shortcut to the editor) |
| `/admin2/roles` | Coming-soon "Role Manager" | **Read-only Role Overview** (no edit; Admin 2 cannot edit) |
| `/super-admin/seed` | Coming-soon placeholder | **Read-only explainer** — no promotion UI; hidden from nav |
| `/admin2/settings` | Coming-soon placeholder | **Role-aware redirect** — Super Admin → `/super-admin/app-settings`, Admin 2 → `/admin2/centre` |
| `/admin2/appearance` | Coming-soon placeholder | **Role-aware redirect** — Super Admin → `/super-admin/branding`, Admin 2 → `/admin2/centre` |

App-level settings, branding and appearance are **Super Admin-owned** (`canManageAppSettings`,
`canManageBranding` = Super Admin only). The old `/admin2/settings` and `/admin2/appearance`
coming-soon stubs duplicated that and were dead ends, so they now redirect by role. The account
menu's "App settings" shortcut and the Control Centre "Appearance" card were retired/repointed:
the menu shortcut is Super-Admin-only and points to `/super-admin/app-settings`; the Appearance
card was removed from the Admin 2 Control Centre (Admin 2 cannot manage global appearance, and
per-user theme + font size already live in the header).

The read-only overview is a single shared component:
`src/components/common/RoleOverview.tsx`. It renders role purpose, default landing
path, accessible sections and a plain-language capability summary from
`src/lib/roleConfig.ts`. The Super Admin variant passes `canEdit` to show an
"Open Role Permissions" shortcut; the Admin 2 variant has no edit affordance.

---

## Who can access permission pages

| Role | Role Permissions editor | Role Overview (read-only) | Seed explainer |
|------|:----------------------:|:------------------------:|:--------------:|
| Super Admin | ✅ edit | ✅ `/super-admin/roles` | ✅ (hidden from nav) |
| Admin 2 | ❌ (route blocked) | ✅ `/admin2/roles` view-only | ❌ |
| Admin 1 | ❌ | ❌ | ❌ |
| Coach | ❌ | ❌ | ❌ |
| Archer | ❌ | ❌ | ❌ |

Non-Super-Admin hitting any `/super-admin/*` route is redirected to their own home
by the `RequireAuth` guard (`src/App.tsx`).

### Why Admin 2 cannot edit role permissions

Admin 2 is the national **operational** admin (manage users, scores, content, org
data). Granting or changing permissions is a **system-governance** action that sits
above operational work and could be used for privilege escalation. Therefore:

- Admin 2 has **read-only** visibility of `system.role_permissions` (RLS
  `role_permissions_admin2_read`) and **no** write policy.
- Admin 2 cannot manage Super Admin users (`canManageSuperAdminUsers` → Super Admin
  only) and cannot elevate a user to Super Admin (`canManageUserWithRole` defers to
  `canManageSuperAdminUsers` for super_admin targets).
- The Admin 2 Role page is a read-only overview, not an editor.

---

## Permission helpers (`src/lib/permissions.ts`)

Static, role-based ceiling (RLS is the final authority on the server):

- `canManageRolePermissions(role)` — Super Admin only. Gate for the editor.
- `canAccessSuperAdmin(role)` — Super Admin only.
- `canAccessAdmin2(role)` — Admin 2 + Super Admin.
- `canManageUsers(role)` — Admin 2 + Super Admin.
- `canChangeUserRole(role)` — Admin 2 + Super Admin (entry gate only).
- `canManageSuperAdminUsers(role)` — Super Admin only.
- `canManageUserWithRole(actor, targetRole)` — defers to `canManageSuperAdminUsers`
  when the target is super_admin, so Admin 2 can never act on a Super Admin.
- `canDeleteOrDemoteUser(actor, targetRole)` — never demotes a super_admin from the UI.

Dynamic layer (`hasRolePermission` + `SUPER_ADMIN_LOCKED_OFF_KEYS`): a missing or
failed permission fetch can **never** escalate a lower role — Super-Admin-only keys
are always denied, and the fallback is a safe `false`.

---

## Navigation

- **Super Admin hub** (`src/pages/superadmin/Settings.tsx`): Role Permissions,
  Role Overview, System Rules, App Settings, Branding. The retired
  `admin1-perms` / `admin2-perms` / `seed` cards were removed.
- **Admin 2 Control Centre** (`src/pages/admin2/ControlCentre.tsx`): the
  "Role Manager" card is now "Role Overview — View role definitions (read-only)".
- **Header** and **BottomTabBar**: contain no role-permission links (verified) — no
  change was needed.

---

## Super Admin seeding

`/super-admin/seed` is **not** a promotion tool and must never become one — a
frontend button that creates/promotes a Super Admin would be a role-escalation path.
The page only documents the safe out-of-band procedure (set
`core.profiles.role = 'super_admin'` via the Supabase SQL Editor by a trusted
operator). It is hidden from navigation and remains Super-Admin-gated by the route.

**TODO (deeper security work):** replace the manual SQL step with a dedicated, audited
Supabase **Edge Function** callable only by an existing Super Admin (service-role on
the server), so every promotion is logged and never exposed to the browser.

---

## Database / migrations

No migration was created for this cleanup. The existing RLS already enforces the
required model:

- `system.role_permissions` (migration `016_role_permissions.sql`):
  - `role_permissions_super_admin_all` — Super Admin: full read/write.
  - `role_permissions_admin2_read` — Admin 2 + Super Admin: read-only.
  - `role_permissions_own_role_read` — approved users: read their own role's rows.

Because Admin 2 has only a `SELECT` policy and the write policy requires
`core.is_super_admin()`, Admin 2 **cannot** update permissions at the database level.
No `029_permission_cleanup.sql` is needed.

### Profile privilege protection (migration 031 — run manually)

The final security audit (2026-07-01) added DB-layer enforcement of the Super
Admin protections that previously lived only in the UI/service layer:

- A `BEFORE INSERT/UPDATE` trigger on `core.profiles` makes a user's **own**
  `role` and `status` immutable to themselves (closes self-promotion via a direct
  PostgREST PATCH), and clamps self sign-up to a pending archer/coach.
- `handle_new_user()` no longer trusts a `role` passed in sign-up metadata.
- Re-asserts the `core_profiles_super_full` + `core_profiles_admin2_nonsuper`
  policies (migration 017 PART 2) so Admin 2 can never read/write a Super Admin
  row nor promote anyone **to** super_admin.

`031_final_security_audit.sql` is idempotent and **must be run manually** in the
Supabase SQL Editor before production.

---

## Open TODOs for the final permission review

- Audited Edge Function for Super Admin seeding (replace manual SQL).
- Optional: make Header/BottomTabBar permission-aware (currently role-aware only),
  so toggling a navigation permission also hides the corresponding menu entry.
- Optional: unify the dangerous/locked key sets that currently live in both
  `src/lib/permissions.ts` and `src/services/rolePermissions.ts` behind one export.
- Full server-side security review of every mutating service against its RLS policy
  (defense-in-depth audit), independent of this frontend cleanup.
