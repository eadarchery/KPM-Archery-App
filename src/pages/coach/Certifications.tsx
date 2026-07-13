import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import {
  Button,
  CertBadge,
  Input,
  Textarea,
  Modal,
  Select,
  EmptyState,
  useToast,
  StatCard,
} from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { compressImage, compressPresets } from '@/lib/imageCompress'
import { formatDate, daysUntil, isExpired, today } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { CertificationStatus } from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface CertRow {
  id: string
  coach_id: string
  title: string
  issuer?: string
  certificate_level?: string
  certificate_number?: string
  issued_date?: string
  expiry_date?: string
  cert_url: string
  status: CertificationStatus
  rejection_reason?: string
  reviewed_by?: string
  reviewed_at?: string
  notes?: string
  created_at: string
}

interface UploadForm {
  title: string
  issuer: string
  certificate_level: string
  certificate_number: string
  issued_date: string
  expiry_date: string
  notes: string
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// Values are the STORED (English) levels — the admin review page filters on
// them — while labels render translated.
const CERT_LEVELS = [
  { value: '',                         labelKey: 'certPage.selectLevel' },
  { value: 'School Coach',             labelKey: 'certPage.levelSchool' },
  { value: 'District / PLD Coach',     labelKey: 'certPage.levelPld' },
  { value: 'State Coach',              labelKey: 'certPage.levelState' },
  { value: 'National Coach',           labelKey: 'certPage.levelNational' },
  { value: 'World Archery / External', labelKey: 'certPage.levelExternal' },
  { value: 'Other',                    labelKey: 'crFields.other' },
]

const BLANK_FORM: UploadForm = {
  title: '',
  issuer: '',
  certificate_level: '',
  certificate_number: '',
  issued_date: '',
  expiry_date: '',
  notes: '',
}

const ACCEPTED = '.pdf,.png,.jpg,.jpeg'
const MAX_MB = 10

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function safeName(name: string) {
  return name.replace(/[^a-z0-9._-]/gi, '_').toLowerCase()
}

// Exported: used to compute a coach's certification display badge elsewhere
export function coachCertStatus(certs: Pick<CertRow, 'status' | 'expiry_date'>[]) {
  const approved = certs.filter(c => c.status === 'approved')
  if (approved.length === 0) {
    if (certs.some(c => c.status === 'pending')) return 'pending'
    return 'none'
  }
  const active = approved.filter(c => !c.expiry_date || !isExpired(c.expiry_date))
  return active.length > 0 ? 'certified' : 'expired'
}

async function resolveFileUrl(cert_url: string): Promise<string | null> {
  if (cert_url.startsWith('http')) return cert_url
  const { data } = await supabase.storage
    .from('certifications')
    .createSignedUrl(cert_url, 3600)
  return data?.signedUrl ?? null
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function CoachCertifications() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const queryClient = useQueryClient()

  const [showForm, setShowForm]       = useState(false)
  const [form, setForm]               = useState<UploadForm>(BLANK_FORM)
  const [formErrors, setFormErrors]   = useState<Partial<UploadForm & { file: string }>>({})
  const [uploading, setUploading]     = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [deleteTarget, setDeleteTarget] = useState<CertRow | null>(null)
  const [deleting, setDeleting]         = useState(false)

  const [viewTarget, setViewTarget]     = useState<CertRow | null>(null)
  const [viewUrl, setViewUrl]           = useState<string | null>(null)
  const [viewLoading, setViewLoading]   = useState(false)
  const [isPdf, setIsPdf]               = useState(false)

  const setField = (key: keyof UploadForm, val: string) =>
    setForm(f => ({ ...f, [key]: val }))

  // ── Fetch own certifications ──────────────────────────────────────────────
  const { data: certs = [], isLoading, isError } = useQuery<CertRow[]>({
    queryKey: ['coach-certifications', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return []
      const { data, error } = await supabase
        .from('certifications')
        .select(`
          id, coach_id, title, issuer, certificate_level, certificate_number,
          issued_date, expiry_date, cert_url, status, rejection_reason,
          reviewed_by, reviewed_at, notes, created_at
        `)
        .eq('coach_id', profile.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as CertRow[]
    },
    enabled: !!profile?.id,
    staleTime: 30_000,
  })

  // ── Derived stats ─────────────────────────────────────────────────────────
  const stats = {
    total:    certs.length,
    pending:  certs.filter(c => c.status === 'pending').length,
    approved: certs.filter(c => c.status === 'approved').length,
    rejected: certs.filter(c => c.status === 'rejected').length,
    expiring: certs.filter(c => {
      if (c.status !== 'approved' || !c.expiry_date) return false
      const s = expiryStatus(c.expiry_date)
      return s === 'expiring' || s === 'expired'
    }).length,
  }

  // ── Validation ────────────────────────────────────────────────────────────
  function validate(): boolean {
    const e: typeof formErrors = {}
    if (!form.title.trim())            e.title = t('certPage.errTitle')
    if (!form.certificate_level)       e.certificate_level = t('certPage.errLevel')
    if (!form.issued_date)             e.issued_date = t('certPage.errIssued')
    if (!selectedFile)                 e.file = t('certPage.errFile')
    if (selectedFile) {
      // Images are auto-compressed before upload, so only PDFs (which go up
      // as-is) are hard-gated here; a post-compression check in handleUpload
      // still covers the rare image that can't be shrunk.
      if (selectedFile.type === 'application/pdf' && selectedFile.size > MAX_MB * 1024 * 1024)
        e.file = t('certPage.errFileSize', { max: MAX_MB })
    }
    setFormErrors(e)
    return Object.keys(e).length === 0
  }

  // ── Upload handler ────────────────────────────────────────────────────────
  async function handleUpload() {
    if (!profile?.id) return
    if (!validate()) return
    setUploading(true)
    try {
      // Photos are auto-compressed (PDFs pass through unchanged).
      const file = await compressImage(selectedFile!, compressPresets.proofPhoto)
      if (file.size > MAX_MB * 1024 * 1024) {
        setFormErrors(prev => ({ ...prev, file: t('certPage.errFileSize', { max: MAX_MB }) }))
        return
      }
      const ext  = file.name.split('.').pop() ?? 'bin'
      const path = `${profile.id}/${Date.now()}-${safeName(file.name)}.${ext}`

      const { error: storageErr } = await supabase.storage
        .from('certifications')
        .upload(path, file, { upsert: false })
      if (storageErr) throw storageErr

      const { error: dbErr } = await supabase.from('certifications').insert({
        coach_id:           profile.id,
        title:              form.title.trim(),
        issuer:             form.issuer.trim() || null,
        certificate_level:  form.certificate_level || null,
        certificate_number: form.certificate_number.trim() || null,
        issued_date:        form.issued_date || null,
        expiry_date:        form.expiry_date || null,
        cert_url:          path,
        status:             'pending',
        notes:              form.notes.trim() || null,
      })
      if (dbErr) throw dbErr

      ok(t('certPage.submitted'))
      setForm(BLANK_FORM)
      setSelectedFile(null)
      if (fileRef.current) fileRef.current.value = ''
      setFormErrors({})
      setShowForm(false)
      queryClient.invalidateQueries({ queryKey: ['coach-certifications'] })
    } catch (e: unknown) {
      err((e as Error).message ?? t('certPage.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  // ── Delete/withdraw ───────────────────────────────────────────────────────
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      // Soft-delete: withdraw the certification (keeps the record + file for
      // admin history). RLS allows a coach to withdraw only their own
      // pending/rejected certs; approved certs cannot be withdrawn.
      const { error } = await supabase
        .from('certifications')
        .update({ status: 'withdrawn' })
        .eq('id', deleteTarget.id)
      if (error) throw error
      ok(t('certPage.withdrawn'))
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['coach-certifications'] })
    } catch (e: unknown) {
      err((e as Error).message ?? t('certPage.withdrawFailed'))
    } finally {
      setDeleting(false)
    }
  }

  // ── View proof ────────────────────────────────────────────────────────────
  async function handleViewProof(cert: CertRow) {
    setViewTarget(cert)
    setViewUrl(null)
    setViewLoading(true)
    const isP = cert.cert_url.toLowerCase().includes('.pdf')
    setIsPdf(isP)
    const url = await resolveFileUrl(cert.cert_url)
    setViewUrl(url)
    setViewLoading(false)
  }

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <PageWrapper>
      <PageHead
        title={t('certPage.title')}
        description={t('certPage.description')}
        action={
          <Button variant="primary" onClick={() => setShowForm(v => !v)}>
            {showForm ? t('common.cancel') : `+ ${t('certPage.uploadCert')}`}
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label={t('common.total')}         value={stats.total}    />
        <StatCard label={t('status.pending')}       value={stats.pending}  />
        <StatCard label={t('status.approved')}      value={stats.approved} accent={stats.approved > 0} />
        <StatCard label={t('status.rejected')}      value={stats.rejected} />
        <StatCard label={t('certPage.expiringSoon')} value={stats.expiring} />
      </div>

      {/* Upload form */}
      {showForm && (
        <SectionCard title={t('certPage.uploadNew')} className="mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={`${t('certPage.certTitle')} *`}
              value={form.title}
              onChange={e => setField('title', e.target.value)}
              error={formErrors.title}
              placeholder="e.g. World Archery Level 1"
            />
            <Input
              label={t('certPage.issuer')}
              value={form.issuer}
              onChange={e => setField('issuer', e.target.value)}
              placeholder="e.g. Archery Association of Malaysia"
            />
            <Select
              label={`${t('certPage.levelType')} *`}
              value={form.certificate_level}
              onChange={e => setField('certificate_level', e.target.value)}
              options={CERT_LEVELS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
              error={formErrors.certificate_level}
            />
            <Input
              label={t('certPage.certNumber')}
              value={form.certificate_number}
              onChange={e => setField('certificate_number', e.target.value)}
              placeholder={t('common.optional')}
            />
            <Input
              label={`${t('certPage.issuedDate')} *`}
              type="date"
              value={form.issued_date}
              onChange={e => setField('issued_date', e.target.value)}
              error={formErrors.issued_date}
              max={today()}
            />
            <Input
              label={t('certPage.expiryDate')}
              type="date"
              value={form.expiry_date}
              onChange={e => setField('expiry_date', e.target.value)}
              min={form.issued_date || undefined}
            />
          </div>

          <div className="mt-4">
            <Textarea
              label={t('common.notes')}
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              placeholder={t('certPage.notesPlaceholder')}
              minRows={2}
            />
          </div>

          {/* File upload */}
          <div className="mt-4">
            <label className="text-[12px] font-semibold text-text-dim block mb-1.5">
              {t('certPage.proofFile')} * <span className="text-text-faint font-normal">(PDF, PNG, JPG, JPEG — {t('scoreEntry.max').toLowerCase()} {MAX_MB} MB)</span>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED}
              className="block w-full text-sm text-text-dim
                file:mr-3 file:py-1.5 file:px-3 file:rounded-[var(--r-md)] file:border-0
                file:text-sm file:font-medium file:bg-surface-raised file:text-text
                hover:file:bg-surface-raised/80 cursor-pointer"
              onChange={e => {
                const f = e.target.files?.[0] ?? null
                setSelectedFile(f)
                if (f) setFormErrors(x => ({ ...x, file: undefined }))
              }}
            />
            {formErrors.file && (
              <p className="text-[12px] text-danger font-medium mt-1">{formErrors.file}</p>
            )}
            {selectedFile && (
              <p className="text-xs text-text-dim mt-1">
                {selectedFile.name} — {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-line">
            <Button variant="secondary" onClick={() => { setShowForm(false); setForm(BLANK_FORM); setFormErrors({}) }}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleUpload} disabled={uploading}>
              {uploading ? t('common.uploading') : t('certPage.submitForReview')}
            </Button>
          </div>
        </SectionCard>
      )}

      {/* Certificate list */}
      <SectionCard title={`${t('certPage.myCerts')} (${certs.length})`}>
        {isLoading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 rounded-[var(--r-md)] bg-surface-raised animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <p className="text-sm text-danger text-center py-6">
            {t('common.loadFailed')}
          </p>
        )}

        {!isLoading && !isError && certs.length === 0 && (
          <EmptyState
            icon={
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/>
              </svg>
            }
            title={t('certPage.empty')}
            description={t('certPage.emptyHint')}
          />
        )}

        {!isLoading && !isError && certs.length > 0 && (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    {[t('common.title'), t('certPage.issuerCol'), t('certPage.level'), t('certPage.issued'), t('certPage.expires'), t('common.status'), t('common.actions')].map(h => (
                      <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint pb-2 pr-4 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {certs.map(cert => <CertTableRow key={cert.id} cert={cert} onView={handleViewProof} onDelete={setDeleteTarget} />)}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden space-y-3">
              {certs.map(cert => <CertCard key={cert.id} cert={cert} onView={handleViewProof} onDelete={setDeleteTarget} />)}
            </div>
          </>
        )}
      </SectionCard>

      {/* Delete confirm modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={t('certPage.withdrawTitle')}
      >
        <p className="text-sm text-text-dim mb-5">
          {t('certPage.withdrawMessage', { title: deleteTarget?.title ?? '' })}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? t('common.processing') : t('common.withdraw')}
          </Button>
        </div>
      </Modal>

      {/* View proof modal */}
      <Modal
        open={!!viewTarget}
        onClose={() => { setViewTarget(null); setViewUrl(null) }}
        title={viewTarget?.title ?? t('certPage.viewProof')}
        width="min(820px,100%)"
      >
        {viewLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!viewLoading && viewUrl && isPdf && (
          <div className="text-center py-6">
            <p className="text-sm text-text-dim mb-4">{t('certPage.pdfNewTab')}</p>
            <Button variant="primary" onClick={() => window.open(viewUrl, '_blank')}>
              {t('certPage.openPdf')}
            </Button>
          </div>
        )}
        {!viewLoading && viewUrl && !isPdf && (
          <img src={viewUrl} alt="Certificate proof" className="w-full max-h-[70vh] object-contain rounded-[var(--r-md)]" />
        )}
        {!viewLoading && !viewUrl && (
          <p className="text-sm text-text-dim text-center py-8">{t('certPage.proofLoadFailed')}</p>
        )}
      </Modal>
    </PageWrapper>
  )
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function CertTableRow({
  cert,
  onView,
  onDelete,
}: {
  cert: CertRow
  onView: (c: CertRow) => void
  onDelete: (c: CertRow) => void
}) {
  const { t } = useLanguage()
  const expiry = expiryStatus(cert.expiry_date)

  return (
    <tr className="hover:bg-surface-raised/40 transition-colors">
      <td className="py-3 pr-4 font-medium text-text max-w-[180px] truncate">{cert.title}</td>
      <td className="py-3 pr-4 text-text-dim whitespace-nowrap">{cert.issuer ?? '—'}</td>
      <td className="py-3 pr-4 text-text-dim whitespace-nowrap">{cert.certificate_level ?? '—'}</td>
      <td className="py-3 pr-4 text-text-dim whitespace-nowrap">
        {cert.issued_date ? formatDate(cert.issued_date) : '—'}
      </td>
      <td className="py-3 pr-4 whitespace-nowrap">
        {cert.expiry_date ? (
          <span className={cn(
            'text-sm',
            expiry === 'expired'  && 'text-danger font-medium',
            expiry === 'expiring' && 'text-warning font-medium',
            expiry === 'ok'       && 'text-text-dim',
          )}>
            {formatDate(cert.expiry_date)}
            {expiry === 'expired'  && ` (${t('status.expired')})`}
            {expiry === 'expiring' && ` (${daysUntil(cert.expiry_date)}d)`}
          </span>
        ) : '—'}
      </td>
      <td className="py-3 pr-4 whitespace-nowrap">
        <CertBadge status={cert.status} />
        {cert.status === 'rejected' && cert.rejection_reason && (
          <p className="text-[11px] text-danger mt-0.5 max-w-[160px] truncate" title={cert.rejection_reason}>
            {cert.rejection_reason}
          </p>
        )}
      </td>
      <td className="py-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => onView(cert)}>{t('certPage.viewProof')}</Button>
          {cert.status === 'pending' && (
            <Button variant="ghost" size="sm" onClick={() => onDelete(cert)} className="text-danger hover:text-danger">
              {t('common.withdraw')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

function CertCard({
  cert,
  onView,
  onDelete,
}: {
  cert: CertRow
  onView: (c: CertRow) => void
  onDelete: (c: CertRow) => void
}) {
  const { t } = useLanguage()
  const expiry = expiryStatus(cert.expiry_date)

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-text truncate">{cert.title}</p>
          {cert.issuer && <p className="text-xs text-text-dim">{cert.issuer}</p>}
          {cert.certificate_level && <p className="text-xs text-text-dim">{cert.certificate_level}</p>}
        </div>
        <CertBadge status={cert.status} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-dim">
        <span>{t('certPage.issued')}: <strong className="text-text">{cert.issued_date ? formatDate(cert.issued_date) : '—'}</strong></span>
        <span>
          {t('certPage.expires')}:{' '}
          <strong className={cn(
            expiry === 'expired'  && 'text-danger',
            expiry === 'expiring' && 'text-warning',
            expiry === 'ok'       && 'text-text',
            !expiry               && 'text-text',
          )}>
            {cert.expiry_date
              ? `${formatDate(cert.expiry_date)}${expiry === 'expired' ? ` (${t('status.expired')})` : expiry === 'expiring' ? ` (${daysUntil(cert.expiry_date)}d)` : ''}`
              : '—'}
          </strong>
        </span>
      </div>

      {cert.status === 'rejected' && cert.rejection_reason && (
        <p className="text-xs text-danger bg-danger/10 rounded-[var(--r-sm)] px-2 py-1">
          {t('status.rejected')}: {cert.rejection_reason}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={() => onView(cert)}>{t('certPage.viewProof')}</Button>
        {cert.status === 'pending' && (
          <Button variant="ghost" size="sm" onClick={() => onDelete(cert)} className="text-danger hover:text-danger">
            {t('common.withdraw')}
          </Button>
        )}
      </div>
    </div>
  )
}

function expiryStatus(expiry_date?: string): 'expired' | 'expiring' | 'ok' | null {
  if (!expiry_date) return null
  if (isExpired(expiry_date)) return 'expired'
  const days = daysUntil(expiry_date)
  if (days <= 60) return 'expiring'
  return 'ok'
}
