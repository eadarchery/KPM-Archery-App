/**
 * Calendar-year (competition) age grouping — the single source of truth on the
 * client. Mirrors the SQL in public.leaderboard (migration 059) EXACTLY so the
 * UI preview and the server ranking never disagree.
 *
 * competitionAge = competitionYear - birthYear   (NOT birthday-based)
 * The group therefore rolls over on 1 January automatically.
 */

export type AgeGroup = 'U12' | 'U15' | 'U18' | 'Open'

export function competitionYear(now: Date = new Date()): number {
  return now.getFullYear()
}

export function competitionAge(birthYear: number, year: number = competitionYear()): number {
  return year - birthYear
}

export function ageGroupForAge(age: number): AgeGroup {
  if (age <= 12) return 'U12'
  if (age <= 15) return 'U15'
  if (age <= 18) return 'U18'
  return 'Open'
}

/** Full snapshot for a birth year, or null if the birth year is unknown/invalid. */
export function ageSnapshot(
  birthYear: number | null | undefined,
  year: number = competitionYear(),
): { competition_year: number; competition_age: number; age_group: AgeGroup } | null {
  if (birthYear == null || !Number.isFinite(birthYear) || birthYear < 1900 || birthYear > year) return null
  const age = year - birthYear
  return { competition_year: year, competition_age: age, age_group: ageGroupForAge(age) }
}

/** Derive a birth year from the profile fields we may have (birth_year → DOB → age). */
export function birthYearFromProfile(p: {
  birth_year?: number | null
  date_of_birth?: string | null
  age?: number | null
}): number | null {
  if (p.birth_year != null) return p.birth_year
  if (p.date_of_birth) {
    const y = new Date(p.date_of_birth).getFullYear()
    if (Number.isFinite(y)) return y
  }
  if (p.age != null) return competitionYear() - p.age
  return null
}
