// SheetJS is large and only needed after an explicit import/template action.
// Keeping it dynamic prevents ordinary dashboards and admin list pages from
// paying its download and memory cost.
const loadXlsx = () => import('xlsx')

// ─── TEMPLATE DOWNLOAD ───────────────────────────────────────

export async function downloadTrainingTemplate() {
  const XLSX = await loadXlsx()
  const headers = [
    'archer_id',       // ASM-YYYY-XXXXXX
    'date',            // YYYY-MM-DD
    'arrows_shot',     // integer
    'session_type',    // indoor | outdoor | field | 3d
    'notes',           // optional
  ]
  const example = ['ASM-2024-000001', '2024-06-15', '60', 'indoor', 'Morning session']
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Training Logs')
  XLSX.writeFile(wb, 'training_log_template.xlsx')
}

export async function downloadScoreTemplate() {
  const XLSX = await loadXlsx()
  const headers = [
    'archer_id',    // ASM-YYYY-XXXXXX
    'date',         // YYYY-MM-DD
    'round_name',   // must match round name in DB
    'total_score',  // integer
    'notes',        // optional
  ]
  const example = ['ASM-2024-000001', '2024-06-15', 'WA 18m (60 arrows)', '285', '']
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Scores')
  XLSX.writeFile(wb, 'score_upload_template.xlsx')
}

// ─── PARSE TRAINING LOG EXCEL ─────────────────────────────────

export interface TrainingRow {
  archer_id: string
  date: string
  arrows_shot: number
  session_type?: string
  notes?: string
  _error?: string
}

export async function parseTrainingExcel(file: File): Promise<TrainingRow[]> {
  const XLSX = await loadXlsx()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

        const parsed: TrainingRow[] = rows.map((row, i) => {
          const archerId  = String(row['archer_id'] ?? '').trim()
          const dateRaw   = row['date']
          const arrowsRaw = row['arrows_shot']

          const date = parseDateCell(dateRaw, XLSX)
          const arrows = parseInt(String(arrowsRaw), 10)

          if (!archerId) return { archer_id: archerId, date: date ?? '', arrows_shot: 0, _error: `Row ${i + 2}: missing archer_id` }
          if (!date)     return { archer_id: archerId, date: '', arrows_shot: 0, _error: `Row ${i + 2}: invalid date` }
          if (isNaN(arrows) || arrows < 0) return { archer_id: archerId, date, arrows_shot: 0, _error: `Row ${i + 2}: invalid arrows_shot` }

          return {
            archer_id:    archerId,
            date,
            arrows_shot:  arrows,
            session_type: String(row['session_type'] ?? '').trim() || undefined,
            notes:        String(row['notes'] ?? '').trim() || undefined,
          }
        })

        resolve(parsed)
      } catch (err) {
        reject(new Error('Failed to parse Excel file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

// ─── PARSE SCORE EXCEL ────────────────────────────────────────

export interface ScoreRow {
  archer_id: string
  date: string
  round_name: string
  total_score: number
  notes?: string
  _error?: string
}

export async function parseScoreExcel(file: File): Promise<ScoreRow[]> {
  const XLSX = await loadXlsx()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

        const parsed: ScoreRow[] = rows.map((row, i) => {
          const archerId  = String(row['archer_id'] ?? '').trim()
          const dateRaw   = row['date']
          const roundName = String(row['round_name'] ?? '').trim()
          const scoreRaw  = row['total_score']

          const date  = parseDateCell(dateRaw, XLSX)
          const score = parseInt(String(scoreRaw), 10)

          if (!archerId)  return { archer_id: archerId, date: date ?? '', round_name: roundName, total_score: 0, _error: `Row ${i + 2}: missing archer_id` }
          if (!date)      return { archer_id: archerId, date: '', round_name: roundName, total_score: 0, _error: `Row ${i + 2}: invalid date` }
          if (!roundName) return { archer_id: archerId, date, round_name: '', total_score: 0, _error: `Row ${i + 2}: missing round_name` }
          if (isNaN(score)) return { archer_id: archerId, date, round_name: roundName, total_score: 0, _error: `Row ${i + 2}: invalid total_score` }

          return {
            archer_id:   archerId,
            date,
            round_name:  roundName,
            total_score: score,
            notes:       String(row['notes'] ?? '').trim() || undefined,
          }
        })

        resolve(parsed)
      } catch {
        reject(new Error('Failed to parse Excel file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

// ─── PARSE SCHOOLS EXCEL (org bulk import) ───────────────────
// Accepts the national school-list export: NEGERI · PPD · KODSEKOLAH ·
// NAMASEKOLAH are required; every other column (PERINGKAT, JENIS/LABEL,
// address/contact fields, MURID/GURU counts, KOORDINATX/Y, …) is kept in
// `meta` so nothing is lost — coordinates can later feed a weather API.

export interface SchoolImportRow {
  state_name: string          // NEGERI
  pld_name: string            // PPD
  code: string                // KODSEKOLAH (unique school code)
  name: string                // NAMASEKOLAH
  address?: string            // ALAMATSURAT (+ POSKODSURAT, BANDARSURAT)
  contact_phone?: string      // NOTELEFON
  contact_email?: string      // EMAIL
  meta: Record<string, unknown>
  _error?: string
}

/** Header lookup tolerant of case, spaces and separators (JENIS/LABEL ≈ jenislabel). */
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export async function downloadSchoolTemplate() {
  const XLSX = await loadXlsx()
  const headers = [
    'NEGERI', 'PPD', 'PERINGKAT', 'JENIS/LABEL', 'KODSEKOLAH', 'NAMASEKOLAH',
    'ALAMATSURAT', 'POSKODSURAT', 'BANDARSURAT', 'NOTELEFON', 'NOFAX', 'EMAIL',
    'LOKASI', 'BANTUAN', 'MURID', 'GURU', 'PRASEKOLAH', 'INTEGRASI',
    'KOORDINATX', 'KOORDINATY',
  ]
  const example = [
    'MELAKA', 'PPD MELAKA TENGAH', 'MENENGAH', 'SMK', 'MEA2001',
    'SMK DATUK BENDAHARA', 'JALAN CONTOH 1', '75000', 'MELAKA', '06-1234567',
    '', 'contoh@moe.edu.my', 'BANDAR', 'KERAJAAN', '850', '65', 'TIADA', 'TIADA',
    '102.2500', '2.2000',
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Schools')
  XLSX.writeFile(wb, 'school_import_template.xlsx')
}

// ─── BULK-SETUP TEMPLATES (coaches / archers / admins) ───────────────────────
// Downloadable templates so schools and PLDs can prepare data in a consistent
// shape before onboarding. Column names are stable identifiers (English,
// snake_case) so the same file works regardless of the admin's UI language;
// the Import Guide explains each column in EN + BM.

export async function downloadCoachTemplate() {
  const XLSX = await loadXlsx()
  const headers = [
    'name',                // required — full name as per IC
    'email',               // required — unique login email
    'phone',               // optional — +60...
    'school_code',         // required — the school's registration code (Reg: ...)
    'certification_level', // optional — School Coach | District / PLD Coach | State Coach | National Coach | World Archery / External | Other
    'experience_years',    // optional — integer
    'notes',               // optional
  ]
  const example = [
    'Ahmad bin Abdullah', 'ahmad.coach@school.edu.my', '+60123456789',
    'ABC123', 'School Coach', '5', 'Also handles equipment',
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Coaches')
  XLSX.writeFile(wb, 'coach_import_template.xlsx')
}

export async function downloadArcherTemplate() {
  const XLSX = await loadXlsx()
  const headers = [
    'name',          // required — full name as per IC
    'email',         // required — unique login email
    'phone',         // optional — +60...
    'date_of_birth', // optional — YYYY-MM-DD
    'school_code',   // required — the school's registration code (Reg: ...)
    'bow_category',  // optional — Recurve | Compound | Barebow | Instinctive
    'notes',         // optional
  ]
  const example = [
    'Nur Aisyah binti Kamal', 'aisyah@student.edu.my', '+60129876543',
    '2010-03-21', 'ABC123', 'Recurve', '',
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Archers')
  XLSX.writeFile(wb, 'archer_import_template.xlsx')
}

export async function downloadAdminTemplate() {
  const XLSX = await loadXlsx()
  const headers = [
    'name',        // required — full name
    'email',       // required — unique login email
    'phone',       // optional
    'role',        // required — admin1 | admin2
    'state_name',  // required for admin1 scope — must match a state in the app
    'pld_name',    // optional — narrows admin1 scope to one PLD
    'school_name', // optional — narrows admin1 scope to one school
    'notes',       // optional
  ]
  const example = [
    'Siti Norhaliza binti Osman', 'siti.admin@moe.gov.my', '+60111223344',
    'admin1', 'MELAKA', 'PPD MELAKA TENGAH', '', 'State-level approver',
  ]
  const ws = XLSX.utils.aoa_to_sheet([headers, example])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Admins')
  XLSX.writeFile(wb, 'admin_import_template.xlsx')
}

export async function parseSchoolsExcel(file: File): Promise<SchoolImportRow[]> {
  const XLSX = await loadXlsx()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' })

        const parsed: SchoolImportRow[] = rows.map((raw, i) => {
          // Re-key the row by normalized header so column naming is tolerant.
          const row: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(raw)) row[normalizeHeader(k)] = v
          const str = (k: string) => String(row[k] ?? '').trim()

          const state = str('negeri')
          const pld   = str('ppd')
          const code  = str('kodsekolah').toUpperCase()
          const name  = str('namasekolah')

          // Everything except the four core fields is preserved verbatim.
          const meta: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(raw)) {
            const nk = normalizeHeader(k)
            if (['negeri', 'ppd', 'kodsekolah', 'namasekolah'].includes(nk)) continue
            const val = typeof v === 'string' ? v.trim() : v
            if (val !== '' && val != null) meta[k.trim()] = val
          }

          const base: SchoolImportRow = {
            state_name: state, pld_name: pld, code, name,
            address: [str('alamatsurat'), str('poskodsurat'), str('bandarsurat')].filter(Boolean).join(', ') || undefined,
            contact_phone: str('notelefon') || undefined,
            contact_email: str('email') || undefined,
            meta,
          }
          if (!state) return { ...base, _error: `Row ${i + 2}: missing NEGERI` }
          if (!pld)   return { ...base, _error: `Row ${i + 2}: missing PPD` }
          if (!code)  return { ...base, _error: `Row ${i + 2}: missing KODSEKOLAH` }
          if (!name)  return { ...base, _error: `Row ${i + 2}: missing NAMASEKOLAH` }
          return base
        })

        resolve(parsed)
      } catch {
        reject(new Error('Failed to parse Excel file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

// ─── DATE HELPER ─────────────────────────────────────────────

function parseDateCell(raw: unknown, XLSX: Awaited<ReturnType<typeof loadXlsx>>): string | null {
  if (!raw) return null

  // Already a JS Date (xlsx cellDates: true)
  if (raw instanceof Date) {
    const y = raw.getFullYear()
    const m = String(raw.getMonth() + 1).padStart(2, '0')
    const d = String(raw.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  // String in YYYY-MM-DD or DD/MM/YYYY
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/')
    return `${yyyy}-${mm}-${dd}`
  }

  // Excel serial number
  const serial = Number(raw)
  if (!isNaN(serial) && serial > 40000) {
    const date = XLSX.SSF.parse_date_code(serial)
    if (date) {
      const m = String(date.m).padStart(2, '0')
      const d = String(date.d).padStart(2, '0')
      return `${date.y}-${m}-${d}`
    }
  }

  return null
}
