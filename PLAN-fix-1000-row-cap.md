# PLAN 1 (DO FIRST) — Fix the silent 1000-row cap on admin lists and reports

**Rank: #1 of 5. Highest leverage — this is a silent data-correctness bug that gets worse as the program grows.**

## The goal

Supabase (PostgREST) clamps every response to `max-rows` — **default 1000 rows** — regardless of
what the client asks for. Even `.limit(5000)` returns at most 1000. Queries with **no** `.limit()`
or `.range()` also get at most 1000.

Consequence at KPM national scale: the Admin 2 User Manager shows only the **newest 1000 users**
(older pending users become invisible and unapprovable), the score validation lists silently drop
rows, and report aggregations computed from row fetches undercount. Nothing errors — the data is
just missing. Fix: a shared batched-fetch helper that pages through `.range()` windows, applied to
every unbounded/over-limit query.

## Exact files to touch

1. `src/services/supabase.ts` — add the `fetchAllRows` helper (export it from here so every service can use it).
2. `src/services/users.ts` — `getUsersAdmin()` (~line 159): no limit today.
3. `src/pages/admin2/Scores.tsx` — the main list query (~line 206): no limit today.
4. `src/pages/coach/Scores.tsx` — the main list query (~line 335): no limit today.
5. `src/services/reports.ts` — three `.limit(5000)` calls (~lines 357, 391, 396): clamped to 1000 today.
6. `src/i18n/en.ts` + `src/i18n/ms.ts` — one new key pair (see step 6).

Do **NOT** touch:
- `src/services/auditLog.ts` — already correctly paginated with `.range()` (use it as the reference pattern).
- `src/services/leaderboard.ts` — its limits are intentional caps on a ranked board.
- `src/services/notifications.ts`, `articles.ts`, `training.ts` — small intentional limits for feeds.
- `src/pages/admin1/StateReport.tsx` — its raw fetches are replaced entirely by PLAN-statereport-trusted-rpcs. Skip it here to avoid conflicting edits.

## Step-by-step implementation order

### Step 1 — Add the helper to `src/services/supabase.ts`

Append (keep the existing client export untouched):

```ts
/**
 * Fetch ALL rows of a query in .range() batches, because PostgREST clamps every
 * single response to max-rows (default 1000) — even explicit .limit(5000).
 * `buildQuery` must return a NEW query each call (a PostgREST builder is
 * single-use) and MUST apply a stable .order() so batches don't overlap.
 */
export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  batchSize = 1000,
  maxBatches = 30, // hard safety ceiling: 30k rows
): Promise<T[]> {
  const all: T[] = []
  for (let batch = 0; batch < maxBatches; batch++) {
    const from = batch * batchSize
    const { data, error } = await buildQuery(from, from + batchSize - 1)
    if (error) throw error
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < batchSize) return all
  }
  console.warn(`fetchAllRows: hit ${maxBatches * batchSize}-row ceiling; result may be incomplete`)
  return all
}
```

### Step 2 — `src/services/users.ts` `getUsersAdmin()`

Current shape: one `.select(PROFILE_SELECT).order('created_at', { ascending: false })` call, with a
`42703` fallback retry using `PROFILE_SELECT_LEGACY`. Replace **each** of the two fetches (primary
and legacy) with `fetchAllRows`, e.g. for the primary:

```ts
const rows = await fetchAllRows<Profile>((from, to) =>
  supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })   // stable tiebreaker — see edge cases
    .range(from, to),
)
```

Keep the `42703 → legacy columns` fallback logic: wrap the primary `fetchAllRows` call in
`try/catch`; if the caught error's `code === '42703'`, run the same loop with
`PROFILE_SELECT_LEGACY`. Note: `fetchAllRows` throws the raw PostgREST error object, so
`(e as { code?: string }).code` still works — verify by reading the error shape in the catch.
Everything after (`attachOrgLookupMaps` / `attachOrgRelations`) is unchanged.

### Step 3 — `src/pages/admin2/Scores.tsx` main list (~line 206)

The query currently fetches **all statuses, no limit**, then the page filters by tab client-side.
Two changes:

1. Push the active tab's status filter into the query (the page already has a tab→status mapping —
   find it near the query; the stat counters at ~line 264 show the exact `.eq('status', …)` values).
   The "all" tab applies no status filter.
2. Wrap in `fetchAllRows` with `.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)`.

Include the tab in the React Query `queryKey` if it isn't already, so switching tabs refetches.

### Step 4 — `src/pages/coach/Scores.tsx` main list (~line 335)

Same treatment. Careful: the `validate` tab is **link-based** (`.in('archer_id', linkedIds)` on
pending rows — see the comment at ~line 345). Preserve that logic exactly; only add
`fetchAllRows` + the stable secondary order. Coach data volumes are smaller, but the same clamp applies.

### Step 5 — `src/services/reports.ts` `.limit(5000)` calls (~lines 357, 391, 396)

Each currently believes it fetches up to 5000 rows; it actually gets ≤1000. Replace each with
`fetchAllRows` (drop the `.limit(5000)`, add `.order('id')` if the query has no order, add
`.range(from, to)`). Do not change any aggregation math that runs on the rows afterwards.

### Step 6 — User-visible truncation warning (i18n)

Add to **both** `src/i18n/en.ts` and `src/i18n/ms.ts` under the `common` group:

- EN: `listTruncated: 'Showing the first {count} records — refine your filters to see the rest.'`
- MS: `listTruncated: 'Menunjukkan {count} rekod pertama — tapis carian anda untuk melihat selebihnya.'`

In `admin2/Users.tsx`, `admin2/Scores.tsx`, `coach/Scores.tsx`: if the fetched array length is
exactly `30 * 1000` (the helper ceiling), render this line above the list in `text-warning text-xs`.
(Reaching the ceiling is unlikely; the warning is the honesty valve — never silently truncate.)

### Step 7 — Verify

- `node .\node_modules\typescript\bin\tsc --noEmit` then `node .\node_modules\vite\bin\vite.js build`
  (note: `&` in the project path breaks plain npm script invocation on some shells — these direct
  node invocations are the proven method in this repo).
- In the running app (admin2 login), open Users and Scores; in browser DevTools → Network, confirm
  the profile/score requests now carry `Range` headers (`0-999`, then `1000-1999` only when the
  first page is full).

## Edge cases a weaker model would miss

1. **A PostgREST query builder is single-use.** You cannot build one query and call it in a loop —
   `buildQuery` must construct a fresh builder per batch. This is why the helper takes a factory.
2. **Unstable ordering makes batches overlap.** `created_at` has ties (bulk imports create many rows
   in the same second). Without a unique tiebreaker (`.order('id')` as secondary), row N can appear
   in two batches and another row in none. Always add the `id` secondary order.
3. **`.range()` past the end is not an error** — it returns an empty array. The stop condition is
   `rows.length < batchSize`, not an error check.
4. **Do not "fix" this by raising `max-rows` in the Supabase dashboard.** That is a global setting
   that would let any endpoint return unbounded payloads; the batching approach works at any setting.
5. **The users legacy-column fallback**: migration 017 may not be applied in some environments; the
   `42703` retry must survive the refactor (test by temporarily querying a fake column if unsure).
6. **RLS interaction**: coach score lists are RLS-scoped to linked archers — batching does not widen
   access; do not add filters that assume national visibility for coaches.
7. **Data written between batches** can shift `created_at DESC` windows (a new row pushes everything
   down one slot → one duplicate). Harmless for these list screens; do NOT try to solve it with
   snapshots — just be aware the list can contain one dup after a concurrent insert. React keys use
   row ids, so dedupe defensively when concatenating if keys warn: `Array.from(new Map(all.map(r => [r.id, r])).values())`.
8. **React Query caching**: if you add the tab to the fetch, the tab MUST be in the `queryKey`,
   otherwise switching tabs shows stale rows of the previous status.

## Acceptance criteria

- [ ] `fetchAllRows` exists in `src/services/supabase.ts`, is exported, and is the only place range-batching is implemented.
- [ ] `getUsersAdmin`, both Scores page list queries, and the three `reports.ts` 5000-limit queries use it; no `.limit(5000)` remains in `reports.ts`.
- [ ] Every `fetchAllRows` call site has a stable order ending in a unique column (`id`).
- [ ] Legacy `42703` fallback in `getUsersAdmin` still works (code path preserved).
- [ ] Network tab shows sequential `Range: 1000-1999` requests only when page 1 returns 1000 rows.
- [ ] `common.listTruncated` exists in BOTH `en.ts` and `ms.ts`; warning renders only at the ceiling.
- [ ] `tsc --noEmit` and `vite build` pass.
- [ ] No changes to `auditLog.ts`, `leaderboard.ts`, or `StateReport.tsx`.
