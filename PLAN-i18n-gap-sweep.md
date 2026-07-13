# PLAN 5 — Close the bilingual (EN/BM) gaps

**Rank: #5 of 5.** "All UI text must be bilingual (English + Bahasa Melayu)" is a standing project
constraint, and a scan for pages that never call `useLanguage` found real violations — including the
recently added **Talent Rating** page, which is 100% hardcoded English. A BM-language Super Admin
sees a fully English configuration screen today.

## The goal

Every fixed UI literal in the pages below renders through `t('…')` with keys present in **both**
`src/i18n/en.ts` and `src/i18n/ms.ts`. Admin-entered content (names, titles, bodies) is **never**
translated — that rule is documented in `docs/i18n.md` and must be respected.

## Exact files to touch

Pages with **zero** `useLanguage` usage today (verified by scan):

| File | Verdict |
|---|---|
| `src/pages/superadmin/TalentConfig.tsx` (206 lines) | **Main offender — fully hardcoded English.** Group titles/blurbs/rules, field labels, page chrome, toasts, confirm dialog. |
| `src/pages/superadmin/DemoData.tsx` (166 lines) | Translate its fixed chrome (title, buttons, warnings). |
| `src/pages/admin2/AdminSettings.tsx` (15 lines) | Pure `<Navigate>` redirect stub — **no text, skip.** |
| `src/pages/admin2/Appearance.tsx` (14 lines) | Read it first: if it's a redirect/wrapper stub with no literals, skip; if it renders text, translate. |
| `src/pages/admin2/Roles.tsx` (13 lines) | Same check-then-skip/translate rule. |
| `src/pages/superadmin/Roles.tsx` (12 lines) | Same check-then-skip/translate rule. |

Known leftovers listed in `docs/i18n.md` ("Still needing deeper translation"):

- `src/pages/superadmin/RolePermissions.tsx` — create-permission modal, dangerous-change confirm,
  reset/restore confirm dialog bodies.
- RoleOverview prose (per-role summary + capability bullets) — find the component via
  `grep -rn "Role Overview" src/` or the `roleOverview` i18n group usage.
- `ROLE_PERMISSION_CATEGORIES` + System Rules category labels (data-driven English label maps).

Dictionaries: `src/i18n/en.ts` + `src/i18n/ms.ts` (every new key goes in BOTH).

## Step-by-step implementation order

### Step 1 — TalentConfig.tsx (do this one first; it's the constraint violation)

1. Add `const { t } = useLanguage()` (import from `@/contexts/LanguageContext`).
2. The `GROUPS` array (lines ~38–90) is a module-level constant containing `title`, `blurb`, `rule`,
   and field `label` strings. Because `t` is a hook value, **convert the labels to i18n keys** and
   translate at render time:
   - Change `FieldDef.label` / `GroupDef.title|blurb|rule` values to key strings
     (e.g. `title: 'talentConfig.topPerformer.title'`) and wrap every render site in `t(...)`.
   - The `rule` strings contain `{placeholders}` that the page substitutes with live config values —
     check how `rule` is rendered before converting. If the page does its own `{key}` substitution,
     the i18n `t()` interpolation will ALSO try to substitute `{var}` patterns. Safest: keep the
     rule templates in the component but pass them through `t()` with the config values as the
     interpolation object, e.g. key `talentConfig.topPerformer.rule` =
     `'best verified score % ≥ {top_performer_min_pct}'` and call
     `t('talentConfig.topPerformer.rule', cfgAsRecord)`. Verify the existing `{var}` interpolation
     signature in `src/i18n/index.ts` first.
3. Translate page chrome: PageHead title/subtitle, save/reset buttons, unsaved-changes hints, the
   ConfirmDialog title/body, success/error toasts.
4. New `talentConfig` group in both dictionaries. BM copy guidance: Top Performer → "Pencapai
   Terbaik", Fast Improver → "Peningkatan Pantas", Consistent Archer → "Pemanah Konsisten",
   Tournament Ready → "Sedia Kejohanan", Hidden Talent → "Bakat Tersembunyi"; "Minimum scores" →
   "Skor minimum"; "Minimum best score" → "Skor terbaik minimum". Keep "pp" (percentage points)
   untranslated as a unit.

### Step 2 — DemoData.tsx

Translate fixed chrome only (title, description, seed/remove buttons, warning banners, toasts) into
a `demoData` group. The tag names of seeded demo entities (e.g. `[DEMO]` markers) are **data**, not
UI — leave them.

### Step 3 — The three tiny wrapper pages

Read each (`admin2/Appearance.tsx`, `admin2/Roles.tsx`, `superadmin/Roles.tsx`). They are 12–14
lines; most likely `<Navigate>` stubs or thin re-exports of a shared component that is already
translated. Only act if a hardcoded literal is actually rendered. Record the verdict per file in
your final summary.

### Step 4 — RolePermissions modals + RoleOverview prose + category label maps

1. `RolePermissions.tsx`: page chrome is already translated (`rolePermissions.*` group exists) —
   only the modal/dialog bodies listed in docs/i18n.md remain. Extract those literals into new keys
   inside the existing `rolePermissions` group (don't create a new group).
2. RoleOverview per-role prose: add to the existing `roleOverview` group.
3. Category label maps (`ROLE_PERMISSION_CATEGORIES`, System Rules categories): these are
   data-driven maps keyed by category id. Convert render sites to
   `t('rolePermissions.categories.' + cat)` / `t('systemRules.categories.' + cat)` with a key per
   category id, keeping the English map as the non-React fallback where a pure function needs it
   (same convention `docs/i18n.md` describes for `utils/format.ts` label maps).

### Step 5 — Parity check + build

- Parity: for every key added to `en.ts`, `ms.ts` must have it (and vice-versa). Quick check —
  temporarily switch the app to BM and click through every touched screen; any English that isn't
  admin-entered content is a missed key. (The fallback chain `ms → en → key` hides mistakes —
  visual inspection in BM is the only reliable check.)
- `node .\node_modules\typescript\bin\tsc --noEmit` and `node .\node_modules\vite\bin\vite.js build`.

## Edge cases a weaker model would miss

1. **Module-level constants can't call hooks.** `GROUPS` in TalentConfig is defined outside the
   component. Store *keys* in the constant and call `t()` at render time — do NOT move the whole
   array inside the component and call `t()` in its definition unless you also memoise it; the
   simplest correct pattern is keys-in-constant + `t()` at JSX render.
2. **Double interpolation collision** in TalentConfig `rule` strings: both the page's own
   placeholder substitution and the i18n `{var}` interpolation use `{name}` syntax. Unify on the
   i18n interpolation (pass the live config object to `t()`), and delete the page's own substitution
   for those strings — running both would corrupt the output.
3. **Never translate**: demo-data tags, archer/school/state names, config numeric values, the
   literal unit "pp"/"%" suffixes, raw audit action keys.
4. **Don't rename or move existing keys** — other components reference them; only add.
5. **`ms → en → key` fallback masks missing BM keys** — the app will look "fine" in BM even if you
   forget half the `ms.ts` entries. The BM visual pass (Step 5) is mandatory, not optional.
6. **BM style consistency**: this codebase's BM uses "anda" (not "kamu"), sentence case, and keeps
   technical terms like "pp", "RLS", "%": match the tone of existing `ms.ts` entries in the same
   groups.
7. **`t()` interpolation signature**: confirm `t(key, vars)` accepts numbers (the talent config
   values are numbers); if it stringifies, pre-format with `String(v)`.
8. **AdminSettings.tsx really has no UI** (it's a `<Navigate>`; verified) — do not invent work there;
   leaving it untouched is correct.

## Acceptance criteria

- [ ] `TalentConfig.tsx` and `DemoData.tsx` contain no rendered hardcoded English UI literals; both
      import and use `useLanguage`.
- [ ] Talent group titles/blurbs/rules/field labels/toasts/confirm dialogs all render in BM when the
      language is BM, with live config values still substituted correctly into rule strings.
- [ ] The three wrapper pages have a recorded verdict (translated or confirmed no-text stub).
- [ ] RolePermissions modal bodies, RoleOverview prose, and category labels render translated in BM.
- [ ] Every new key exists in BOTH `en.ts` and `ms.ts` (spot-check by diffing the added key names).
- [ ] Admin-entered content is untouched (no `t()` wrapped around data values).
- [ ] `tsc --noEmit` + `vite build` pass.
