import { supabase } from './supabase'

/**
 * Client-side org-name resolution.
 *
 * PostgREST relationship embedding of org tables ON a profiles resource
 * (e.g. `school:school_id ( id, name )` inside a `profiles` / `archer:archer_id`
 * select) is unreliable through the project's security_invoker public views and
 * can fail the whole request with PGRST200. Instead of embedding, callers fetch
 * flat FK id columns (school_id / pld_id / state_id) and resolve the display
 * names from these small, cacheable lookup maps.
 */

export interface OrgLite  { id: string; name: string }
export interface StateLite { id: string; name: string; code: string }

export interface OrgMaps {
  states:  Map<string, StateLite>
  plds:    Map<string, OrgLite>
  schools: Map<string, OrgLite>
}

/** Load id→row maps for states, PLDs and schools. */
export async function fetchOrgMaps(): Promise<OrgMaps> {
  const [st, pl, sc] = await Promise.all([
    supabase.from('states').select('id, name, code'),
    supabase.from('plds').select('id, name'),
    supabase.from('schools').select('id, name'),
  ])
  return {
    states:  new Map(((st.data ?? []) as StateLite[]).map((s) => [s.id, s])),
    plds:    new Map(((pl.data ?? []) as OrgLite[]).map((p) => [p.id, p])),
    schools: new Map(((sc.data ?? []) as OrgLite[]).map((s) => [s.id, s])),
  }
}
