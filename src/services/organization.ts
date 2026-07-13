import { supabase } from './supabase'
import { useAuthStore } from '@/store/authStore'
import { assertCan, canManageStates, canManagePLDs, canManageSchools } from '@/lib/permissions'
import { writeAuditLog } from './auditLog'

// ─── RICH MANAGEMENT TYPES ────────────────────────────────────────────────────
// These extend the base types with computed fields used in management pages.

export interface OrgState {
  id: string
  name: string
  code: string
  active: boolean
  created_at: string
  updated_at: string
  pld_count: number
  school_count: number
}

export interface OrgPLD {
  id: string
  name: string
  code: string | null
  state_id: string
  state_name: string
  active: boolean
  created_at: string
  updated_at: string
  school_count: number
}

export interface OrgSchool {
  id: string
  name: string
  code: string | null
  reg_code: string | null   // archer registration code (unique)
  pld_id: string | null
  pld_name: string | null
  state_id: string
  state_name: string
  address: string | null
  contact_person: string | null
  contact_email: string | null
  contact_phone: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface OrgSummary {
  totalStates: number
  activeStates: number
  inactiveStates: number
  totalPLDs: number
  activePLDs: number
  inactivePLDs: number
  statesCoveredByPLDs: number
  totalSchools: number
  activeSchools: number
  inactiveSchools: number
  statesCoveredBySchools: number
  pldsCoveredBySchools: number
}

// ─── PAYLOAD TYPES ────────────────────────────────────────────────────────────

export interface StatePayload {
  name: string
  code: string
  active?: boolean
}

export interface PLDPayload {
  name: string
  code?: string | null
  state_id: string
  active?: boolean
}

export interface SchoolPayload {
  name: string
  code?: string | null
  reg_code?: string        // archer registration code; omit to auto-generate on create
  state_id: string
  pld_id?: string | null
  address?: string | null
  contact_person?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  active?: boolean
}

// ─── INTERNAL HELPERS ─────────────────────────────────────────────────────────

function actor() {
  const p = useAuthStore.getState().profile
  return { id: p?.id ?? '', role: p?.role }
}

// ─── READ — MANAGEMENT VIEWS (with counts) ───────────────────────────────────

/** All states with PLD and school counts. Used by the States management page. */
export async function getStates(): Promise<OrgState[]> {
  const [sr, pr, scr] = await Promise.all([
    supabase.from('states').select('id, name, code, active, created_at, updated_at').order('name'),
    supabase.from('plds').select('id, state_id'),
    supabase.from('schools').select('id, state_id'),
  ])
  if (sr.error) throw sr.error
  const plds    = (pr.data   ?? []) as { id: string; state_id: string }[]
  const schools = (scr.data  ?? []) as { id: string; state_id: string }[]
  return ((sr.data ?? []) as OrgState[]).map(s => ({
    ...s,
    pld_count:    plds.filter(p  => p.state_id === s.id).length,
    school_count: schools.filter(sc => sc.state_id === s.id).length,
  }))
}

/** All PLDs with state name and school count. Used by the PLDs management page. */
export async function getPLDs(): Promise<OrgPLD[]> {
  const [pr, sr, scr] = await Promise.all([
    supabase.from('plds').select('id, name, code, state_id, active, created_at, updated_at').order('name'),
    supabase.from('states').select('id, name'),
    supabase.from('schools').select('id, pld_id'),
  ])
  if (pr.error) throw pr.error
  const states  = (sr.data  ?? []) as { id: string; name: string }[]
  const schools = (scr.data ?? []) as { id: string; pld_id: string | null }[]
  return ((pr.data ?? []) as Omit<OrgPLD, 'state_name' | 'school_count'>[]).map(p => ({
    ...p,
    state_name:   states.find(s => s.id === p.state_id)?.name ?? '—',
    school_count: schools.filter(sc => sc.pld_id === p.id).length,
  }))
}

/** All schools with state and PLD names. Used by the Schools management page. */
export async function getSchools(): Promise<OrgSchool[]> {
  const [scr, sr, pr] = await Promise.all([
    supabase.from('schools').select('id, name, code, reg_code, pld_id, state_id, address, contact_person, contact_email, contact_phone, active, created_at, updated_at').order('name'),
    supabase.from('states').select('id, name'),
    supabase.from('plds').select('id, name'),
  ])
  if (scr.error) throw scr.error
  const states = (sr.data ?? []) as { id: string; name: string }[]
  const plds   = (pr.data ?? []) as { id: string; name: string }[]
  return ((scr.data ?? []) as Omit<OrgSchool, 'state_name' | 'pld_name'>[]).map(s => ({
    ...s,
    state_name: states.find(st => st.id === s.state_id)?.name ?? '—',
    pld_name:   s.pld_id ? (plds.find(p => p.id === s.pld_id)?.name ?? '—') : null,
  }))
}

/** Aggregate summary counts across all org entities. */
export async function getOrganizationSummary(): Promise<OrgSummary> {
  const [sr, pr, scr] = await Promise.all([
    supabase.from('states').select('id, active'),
    supabase.from('plds').select('id, state_id, active'),
    supabase.from('schools').select('id, state_id, pld_id, active'),
  ])
  if (sr.error) throw sr.error
  const states  = (sr.data  ?? []) as { id: string; active: boolean }[]
  const plds    = (pr.data  ?? []) as { id: string; state_id: string; active: boolean }[]
  const schools = (scr.data ?? []) as { id: string; state_id: string; pld_id: string | null; active: boolean }[]

  return {
    totalStates:         states.length,
    activeStates:        states.filter(s => s.active).length,
    inactiveStates:      states.filter(s => !s.active).length,
    totalPLDs:           plds.length,
    activePLDs:          plds.filter(p => p.active).length,
    inactivePLDs:        plds.filter(p => !p.active).length,
    statesCoveredByPLDs: new Set(plds.map(p => p.state_id)).size,
    totalSchools:        schools.length,
    activeSchools:       schools.filter(s => s.active).length,
    inactiveSchools:     schools.filter(s => !s.active).length,
    statesCoveredBySchools: new Set(schools.map(s => s.state_id)).size,
    pldsCoveredBySchools:   new Set(schools.filter(s => s.pld_id).map(s => s.pld_id as string)).size,
  }
}

// ─── READ — LIGHTWEIGHT SELECTS (for dropdowns / user management) ─────────────

export async function getActiveStates() {
  const { data, error } = await supabase.from('states').select('id, name, code').eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as { id: string; name: string; code: string }[]
}

export async function getActivePLDs() {
  const { data, error } = await supabase.from('plds').select('id, name, state_id').eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as { id: string; name: string; state_id: string }[]
}

export async function getActiveSchools() {
  const { data, error } = await supabase.from('schools').select('id, name, pld_id, state_id').eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as { id: string; name: string; pld_id: string | null; state_id: string }[]
}

export async function getPLDsByState(stateId: string) {
  const { data, error } = await supabase
    .from('plds').select('id, name, code, state_id').eq('state_id', stateId).eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as { id: string; name: string; code: string | null; state_id: string }[]
}

export async function getSchoolsByPLD(pldId: string) {
  const { data, error } = await supabase
    .from('schools').select('id, name, pld_id, state_id').eq('pld_id', pldId).eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as { id: string; name: string; pld_id: string | null; state_id: string }[]
}

export async function getSchoolsByState(stateId: string) {
  const { data, error } = await supabase
    .from('schools').select('id, name, pld_id, state_id').eq('state_id', stateId).eq('active', true).order('name')
  if (error) throw error
  return (data ?? []) as { id: string; name: string; pld_id: string | null; state_id: string }[]
}

// ─── STATE MUTATIONS ─────────────────────────────────────────────────────────

export async function createState(payload: StatePayload): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManageStates(role), 'create states')
  const { data, error } = await supabase.from('states').insert({ ...payload, active: payload.active ?? true }).select('id').single()
  if (error) throw error
  writeAuditLog(actorId, 'organization.state.created', 'state', data.id, { name: payload.name }).catch(console.warn)
}

export async function updateState(id: string, payload: Partial<StatePayload>): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManageStates(role), 'update states')
  const { error } = await supabase.from('states').update(payload).eq('id', id)
  if (error) throw error
  writeAuditLog(actorId, 'organization.state.updated', 'state', id, payload).catch(console.warn)
}

export async function archiveState(id: string): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManageStates(role), 'archive states')
  const { error } = await supabase.from('states').update({ active: false }).eq('id', id)
  if (error) throw error
  writeAuditLog(actorId, 'organization.state.archived', 'state', id).catch(console.warn)
}

export async function reactivateState(id: string): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManageStates(role), 'reactivate states')
  const { error } = await supabase.from('states').update({ active: true }).eq('id', id)
  if (error) throw error
  writeAuditLog(actorId, 'organization.state.reactivated', 'state', id).catch(console.warn)
}

// ─── PLD MUTATIONS ────────────────────────────────────────────────────────────

export async function createPLD(payload: PLDPayload): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManagePLDs(role), 'create PLDs')
  const { data, error } = await supabase.from('plds').insert({ ...payload, active: payload.active ?? true }).select('id').single()
  if (error) throw error
  writeAuditLog(actorId, 'organization.pld.created', 'pld', data.id, { name: payload.name, state_id: payload.state_id }).catch(console.warn)
}

export async function updatePLD(id: string, payload: Partial<PLDPayload>): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManagePLDs(role), 'update PLDs')
  const { error } = await supabase.from('plds').update(payload).eq('id', id)
  if (error) throw error
  writeAuditLog(actorId, 'organization.pld.updated', 'pld', id, payload).catch(console.warn)
}

export async function archivePLD(id: string): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManagePLDs(role), 'archive PLDs')
  const { error } = await supabase.from('plds').update({ active: false }).eq('id', id)
  if (error) throw error
  writeAuditLog(actorId, 'organization.pld.archived', 'pld', id).catch(console.warn)
}

export async function reactivatePLD(id: string): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManagePLDs(role), 'reactivate PLDs')
  const { error } = await supabase.from('plds').update({ active: true }).eq('id', id)
  if (error) throw error
  writeAuditLog(actorId, 'organization.pld.reactivated', 'pld', id).catch(console.warn)
}

// ─── SCHOOL MUTATIONS ─────────────────────────────────────────────────────────

/**
 * Normalize a school payload's reg_code: uppercase + trimmed, or omit it entirely
 * when blank so the DB DEFAULT auto-generates a unique code (on insert) or the
 * existing code is left unchanged (on update).
 */
function normalizeSchoolPayload<T extends Partial<SchoolPayload>>(payload: T): T {
  const out = { ...payload }
  if ('reg_code' in out) {
    const rc = (out.reg_code ?? '').toString().trim().toUpperCase()
    if (rc) out.reg_code = rc
    else delete out.reg_code
  }
  return out
}

/** Turn a Postgres unique-violation on reg_code into a friendly message. */
function translateSchoolWriteError(error: { code?: string; message?: string }): Error {
  if (error.code === '23505' && /reg_code/i.test(error.message ?? '')) {
    return new Error('That registration code is already used by another school. Please choose a different code.')
  }
  return new Error(error.message ?? 'Saving the school failed.')
}

export async function createSchool(payload: SchoolPayload): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManageSchools(role), 'create schools')
  const insert = normalizeSchoolPayload({ ...payload, active: payload.active ?? true })
  const { data, error } = await supabase.from('schools').insert(insert).select('id').single()
  if (error) throw translateSchoolWriteError(error)
  writeAuditLog(actorId, 'organization.school.created', 'school', data.id, { name: payload.name }).catch(console.warn)
}

export async function updateSchool(id: string, payload: Partial<SchoolPayload>): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManageSchools(role), 'update schools')
  const update = normalizeSchoolPayload(payload)
  const { error } = await supabase.from('schools').update(update).eq('id', id)
  if (error) throw translateSchoolWriteError(error)
  writeAuditLog(actorId, 'organization.school.updated', 'school', id, payload).catch(console.warn)
}

// ─── SCHOOL BULK IMPORT (Excel) ───────────────────────────────────────────────

export interface SchoolImportInput {
  state_name: string
  pld_name: string
  code: string
  name: string
  address?: string
  contact_phone?: string
  contact_email?: string
  meta: Record<string, unknown>
}

export interface SchoolImportResult {
  created: number
  updated: number
  pldsCreated: number
  skipped: { row: SchoolImportInput; reason: string }[]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Import-friendly error text; flags the missing meta column as "run 056". */
function importErrorReason(error: { code?: string; message?: string }): string {
  if (error.code === 'PGRST204' && /meta/.test(error.message ?? '')) {
    return 'Run migration 056_schools_import_meta.sql first (meta column missing).'
  }
  return error.message ?? 'Write failed.'
}

/**
 * Import/refresh schools from the national Excel list. States must already
 * exist (matched by name — they are a fixed set); missing PLDs (PPD) are
 * created under the matched state; schools are matched by their KODSEKOLAH
 * `code` — updated when found, inserted when new. Extra spreadsheet columns
 * travel in `meta` (needs migration 056).
 */
export async function importSchools(rows: SchoolImportInput[]): Promise<SchoolImportResult> {
  const { id: actorId, role } = actor()
  assertCan(canManageSchools(role), 'import schools')

  const [statesRes, pldsRes, schoolsRes] = await Promise.all([
    supabase.from('states').select('id, name'),
    supabase.from('plds').select('id, name, state_id'),
    supabase.from('schools').select('id, code'),
  ])
  if (statesRes.error) throw statesRes.error
  if (pldsRes.error) throw pldsRes.error
  if (schoolsRes.error) throw schoolsRes.error

  const stateByName = new Map((statesRes.data ?? []).map(s => [norm(s.name), s.id as string]))
  const pldByKey    = new Map((pldsRes.data ?? []).map(p => [`${p.state_id}|${norm(p.name)}`, p.id as string]))
  const schoolByCode = new Map(
    ((schoolsRes.data ?? []) as { id: string; code: string | null }[])
      .filter(s => s.code)
      .map(s => [s.code!.trim().toUpperCase(), s.id]),
  )

  const result: SchoolImportResult = { created: 0, updated: 0, pldsCreated: 0, skipped: [] }

  for (const row of rows) {
    const stateId = stateByName.get(norm(row.state_name))
    if (!stateId) {
      result.skipped.push({ row, reason: `State "${row.state_name}" not found — create it first.` })
      continue
    }

    // PLD: reuse if present, create once otherwise (subsequent rows hit the map).
    const pldKey = `${stateId}|${norm(row.pld_name)}`
    let pldId = pldByKey.get(pldKey)
    if (!pldId) {
      const { data, error } = await supabase.from('plds')
        .insert({ name: row.pld_name.trim(), state_id: stateId, active: true })
        .select('id').single()
      if (error) {
        result.skipped.push({ row, reason: `Could not create PLD "${row.pld_name}": ${error.message}` })
        continue
      }
      pldId = data.id as string
      pldByKey.set(pldKey, pldId)
      result.pldsCreated++
    }

    const payload = {
      name: row.name.trim(),
      code: row.code,
      state_id: stateId,
      pld_id: pldId,
      address: row.address ?? null,
      contact_phone: row.contact_phone ?? null,
      contact_email: row.contact_email ?? null,
      meta: row.meta,
      active: true,
    }

    const existingId = schoolByCode.get(row.code)
    if (existingId) {
      const { error } = await supabase.from('schools').update(payload).eq('id', existingId)
      if (error) { result.skipped.push({ row, reason: importErrorReason(error) }); continue }
      result.updated++
    } else {
      const { data, error } = await supabase.from('schools').insert(payload).select('id').single()
      if (error) { result.skipped.push({ row, reason: importErrorReason(error) }); continue }
      result.created++
      // Duplicate codes later in the same file become updates of this row.
      schoolByCode.set(row.code, data.id as string)
    }
  }

  writeAuditLog(actorId, 'organization.school.bulk_imported', 'school', 'bulk', {
    created: result.created, updated: result.updated,
    plds_created: result.pldsCreated, skipped: result.skipped.length,
  }).catch(console.warn)

  return result
}

export async function archiveSchool(id: string): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManageSchools(role), 'archive schools')
  const { error } = await supabase.from('schools').update({ active: false }).eq('id', id)
  if (error) throw error
  writeAuditLog(actorId, 'organization.school.archived', 'school', id).catch(console.warn)
}

export async function reactivateSchool(id: string): Promise<void> {
  const { id: actorId, role } = actor()
  assertCan(canManageSchools(role), 'reactivate schools')
  const { error } = await supabase.from('schools').update({ active: true }).eq('id', id)
  if (error) throw error
  writeAuditLog(actorId, 'organization.school.reactivated', 'school', id).catch(console.warn)
}
