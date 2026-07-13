# PLAN 2 — Notification "Draft ≠ Sent" safeguard

**Rank: #2 of 5. Tiny effort, prevents a failure that already happened in production use:** an
admin composed an "Everyone" notification, left Publish Mode on the default **Save as Draft**, and
believed it was sent. Drafts have `published_at = NULL`, and the RLS read policy
(`notifications_approved_read`, migration 054) only delivers rows with
`published_at IS NOT NULL AND published_at <= now()` — so a draft reaches **no one**, silently.

## The goal

Make it impossible to save a draft while believing it was delivered:
1. An inline warning under Publish Mode whenever "Save as Draft" is selected.
2. The submit button says what will actually happen (Save draft / Publish / Schedule).
3. The success toast for a draft explicitly says "not sent yet".
4. Draft cards in the manager list carry a "not delivered" hint, and their Publish action is
   always visible (not hover-only) on desktop.

All copy bilingual (EN + BM). **No database or service changes — this is purely
`src/pages/admin2/Notifications.tsx` + i18n.**

## Exact files to touch

1. `src/pages/admin2/Notifications.tsx` (only file with logic changes)
2. `src/i18n/en.ts` — new keys in the existing `notifPage` group
3. `src/i18n/ms.ts` — same keys, BM copy

## Landmarks in `Notifications.tsx` (verify line numbers before editing — they drift)

- ~line 109: `_status` derivation — `if (!n.published_at || n.status === 'draft') return 'draft'`
- ~line 247: `createMut` — success toast `ok(...)` + audit log
- ~line 283: `updateMut` success toast
- ~line 549: `showPublish = n._status === 'draft' || n._status === 'scheduled'` (card action row)
- ~line 566: desktop action buttons container with `opacity-0 group-hover:opacity-100`
- ~line 609–620: mobile action row (Publish already included at ~615 — leave as is)
- ~line 688: `publishMode` state, default `'draft'`
- ~line 738: `handleSubmit` — maps publishMode → status/published_at (do NOT change this logic)
- ~line 890–916: Publish Mode 3-button block
- ~line 943: submit `<Button>` — currently `saveChanges` / `createNotification`

## Step-by-step implementation order

### Step 1 — i18n keys (both files, `notifPage` group)

EN (`src/i18n/en.ts`):
```ts
draftWarning: 'A draft is saved but NOT sent — no one will receive it. Choose "Publish Now" to deliver it.',
draftNotSentHint: 'Not delivered — recipients will not see this until you publish it.',
saveDraftBtn: 'Save draft (not sent)',
publishBtn: 'Publish',
scheduleBtn: 'Schedule',
savedDraftToast: 'Draft saved — NOT sent. Publish it when ready.',
savedDraftMultiToast: '{count} drafts saved — NOT sent. Publish them when ready.',
```
MS (`src/i18n/ms.ts`):
```ts
draftWarning: 'Draf hanya disimpan dan TIDAK dihantar — tiada sesiapa akan menerimanya. Pilih "Terbitkan Sekarang" untuk menghantarnya.',
draftNotSentHint: 'Belum dihantar — penerima tidak akan melihatnya sehingga anda menerbitkannya.',
saveDraftBtn: 'Simpan draf (tidak dihantar)',
publishBtn: 'Terbitkan',
scheduleBtn: 'Jadualkan',
savedDraftToast: 'Draf disimpan — TIDAK dihantar. Terbitkan apabila sedia.',
savedDraftMultiToast: '{count} draf disimpan — TIDAK dihantar. Terbitkan apabila sedia.',
```
Match the surrounding key style of the `notifPage` group in each file. Both files MUST get all 7 keys.

### Step 2 — Inline warning under the Publish Mode buttons (~after line 916)

Immediately after the 3-button `div` (inside the same "Publish mode" wrapper `div`), add:

```tsx
{publishMode === 'draft' && (
  <p className="mt-2 text-xs text-warning bg-warning-soft/30 border border-warning/40 rounded-[8px] px-3 py-2 leading-relaxed">
    {t('notifPage.draftWarning')}
  </p>
)}
```
Check that `text-warning` / `bg-warning-soft` utility classes are used elsewhere in this file or in
`ValidationSummary.tsx`; if the soft variant doesn't exist in the Tailwind config, fall back to
`text-warning` + `border-warning` only.

### Step 3 — Dynamic submit button label (~line 943)

Replace the label expression with a publishMode-driven one:

```tsx
<Button onClick={handleSubmit} loading={saving}>
  {publishMode === 'draft'
    ? t('notifPage.saveDraftBtn')
    : publishMode === 'now'
      ? t('notifPage.publishBtn')
      : t('notifPage.scheduleBtn')}
</Button>
```

### Step 4 — Draft-aware success toasts

In `createMut.onSuccess` (~line 259): the mutation returns the created rows; each has `status`.
When `notifs[0]?.status === 'draft'`, use the draft toasts instead of the generic ones:

```ts
const isDraft = notifs[0]?.status === 'draft'
ok(
  notifs.length > 1
    ? t(isDraft ? 'notifPage.savedDraftMultiToast' : 'notifPage.createdMulti', { count: notifs.length })
    : t(isDraft ? 'notifPage.savedDraftToast' : 'notifPage.createdOne'),
)
```
In `updateMut.onSuccess` (~line 283): same idea — `notif.status === 'draft'` →
`t('notifPage.savedDraftToast')`, else keep `t('notifPage.updatedToast')`.

### Step 5 — Draft card hint + always-visible Publish (card component, ~lines 546–620)

1. Inside the card, directly under the status/priority badge row (after the `div` closing at
   ~line 573), add:
```tsx
{n._status === 'draft' && (
  <p className="text-[11px] text-warning mb-1.5">{t('notifPage.draftNotSentHint')}</p>
)}
```
2. Desktop action-buttons container (~line 566) currently hides all actions until hover
   (`opacity-0 group-hover:opacity-100`). Make the container conditional:
```tsx
className={cn(
  'flex items-center gap-0.5 shrink-0 transition-opacity focus-within:opacity-100',
  showPublish ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
)}
```
   (`showPublish` already exists at ~line 549 and covers draft + scheduled — both deserve a
   visible Publish button.) `cn` is already imported in this file.

### Step 6 — Verify

- `node .\node_modules\typescript\bin\tsc --noEmit` + `node .\node_modules\vite\bin\vite.js build`.
- In the app (admin2 or super_admin → Notifications): create a notification, leave "Save as Draft"
  → warning visible, button says "Save draft (not sent)", toast says NOT sent, card shows the hint
  and a visible Publish icon. Switch to "Publish Now" → warning disappears, button says "Publish".
- Switch language to BM and repeat — every new string must render in BM.

## Edge cases a weaker model would miss

1. **Do not change `handleSubmit` / status mapping.** The draft behaviour itself is correct and
   RLS-enforced; only the *communication* around it is being fixed.
2. **Editing an already-published notification**: the mount effect (~line 695) sets publishMode to
   `'now'` for published/expired rows, so the warning correctly stays hidden. But if the admin
   manually clicks "Save as Draft" on a published notification, the warning MUST show — that action
   **unpublishes** it (status → draft, `published_at` → null in `handleSubmit`). The warning copy
   already covers this; just make sure the condition is `publishMode === 'draft'` (live state), not
   the notification's stored status.
3. **Multi-audience creates make one row per audience** (`createMut` loops targets). The plural
   draft toast uses `{count}` — pass `notifs.length`, and check draft-ness from `notifs[0]` (all
   rows share one status).
4. **The `ok()` toast helper** in this page takes `(message)` — confirm its signature near the top
   of the file before adding a second argument.
5. **Mobile**: the hover-opacity trick never worked on touch; that's why the mobile action row
   (~line 609) exists and already shows Publish. Don't duplicate a second publish control there.
6. **i18n `{count}` interpolation** uses the project's `t(key, { count })` convention — copy an
   existing usage (`notifPage.createdMulti`) rather than inventing a plural system.
7. **Scheduled is not draft**: a scheduled notification has `published_at` in the future and WILL
   deliver automatically. Don't show the draft warning for `scheduled`; the existing scheduled-date
   input + badge already communicate it.

## Acceptance criteria

- [ ] Warning appears when and only when "Save as Draft" is the selected publish mode (create AND edit modals).
- [ ] Submit button label reflects the selected mode (draft/now/scheduled) in EN and BM.
- [ ] Saving a draft shows a toast explicitly saying it was NOT sent (single + multi-audience variants).
- [ ] Draft and scheduled cards show their action buttons without hover; draft cards show the "not delivered" hint line.
- [ ] Published/archived cards keep the existing hover-reveal behaviour.
- [ ] All 7 new keys exist in BOTH `en.ts` and `ms.ts`; BM renders correctly in the UI.
- [ ] No changes outside `Notifications.tsx`, `en.ts`, `ms.ts`. `tsc` + `vite build` pass.
