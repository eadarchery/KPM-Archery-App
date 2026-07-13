import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLanguage } from '@/contexts/LanguageContext'
import { parseSchoolsExcel, downloadSchoolTemplate, type SchoolImportRow } from '@/services/excel'
import { importSchools, type SchoolImportResult } from '@/services/organization'
import { cn } from '@/utils/cn'

/**
 * Bulk school import from the national Excel list (NEGERI · PPD · KODSEKOLAH ·
 * NAMASEKOLAH + free extra columns preserved in meta). Parse → preview → import,
 * then a per-row result summary. Matching: state by name (must exist), PLD
 * created if missing, school upserted by KODSEKOLAH.
 */
export function SchoolImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t }       = useLanguage()
  const toast       = useToast()
  const queryClient = useQueryClient()
  const inputRef    = useRef<HTMLInputElement>(null)

  const [rows, setRows]         = useState<SchoolImportRow[]>([])
  const [parsed, setParsed]     = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [result, setResult]     = useState<SchoolImportResult | null>(null)

  const validRows = rows.filter(r => !r._error)
  const errorRows = rows.filter(r => r._error)

  async function handleFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.err(t('excel.invalidFile'), t('excel.invalidFileHint'))
      return
    }
    try {
      const p = await parseSchoolsExcel(file)
      if (!p.length) { toast.err(t('schoolImport.emptyFile'), t('schoolImport.emptyFileHint')); return }
      setRows(p)
      setParsed(true)
      setResult(null)
    } catch (err) {
      toast.err(t('excel.parseFailed'), err instanceof Error ? err.message : t('common.loadFailed'))
    }
  }

  const importMutation = useMutation({
    mutationFn: () => importSchools(validRows.map(({ _error, ...r }) => r)),
    onSuccess: (res) => {
      setResult(res)
      queryClient.invalidateQueries({ queryKey: ['schools-management'] })
      queryClient.invalidateQueries({ queryKey: ['active-plds'] })
      queryClient.invalidateQueries({ queryKey: ['plds-management'] })
      queryClient.invalidateQueries({ queryKey: ['org-summary'] })
      if (res.skipped.length === 0) {
        toast.ok(t('schoolImport.complete'), t('schoolImport.completeHint', { created: res.created, updated: res.updated }))
      } else {
        toast.err(t('schoolImport.withSkips'), t('schoolImport.withSkipsHint', { count: res.skipped.length }))
      }
    },
    onError: (err: Error) => toast.err(t('excel.importFailed'), err.message),
  })

  function reset() {
    setRows([])
    setParsed(false)
    setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function close() {
    if (importMutation.isPending) return
    reset()
    onClose()
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={close} title={t('schoolImport.title')} width="min(760px,100%)">
      <div className="space-y-4">
        {/* Template + column contract */}
        <div className="flex items-center justify-between p-3 rounded-[var(--r)] bg-surface-soft border border-line">
          <div>
            <div className="font-semibold text-sm">{t('schoolImport.oneFile')}</div>
            <div className="text-xs text-text-dim">
              {t('schoolImport.columnsHint')}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={downloadSchoolTemplate}>{t('common.template')}</Button>
        </div>

        {result ? (
          /* Result summary */
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-[var(--r)] bg-surface-soft border border-line">
                <div className="text-xl font-bold text-success">{result.created}</div>
                <div className="text-xs text-text-dim">{t('schoolImport.schoolsCreated')}</div>
              </div>
              <div className="p-3 rounded-[var(--r)] bg-surface-soft border border-line">
                <div className="text-xl font-bold text-text">{result.updated}</div>
                <div className="text-xs text-text-dim">{t('schoolImport.schoolsUpdated')}</div>
              </div>
              <div className="p-3 rounded-[var(--r)] bg-surface-soft border border-line">
                <div className="text-xl font-bold text-text">{result.pldsCreated}</div>
                <div className="text-xs text-text-dim">{t('schoolImport.pldsCreated')}</div>
              </div>
            </div>

            {result.skipped.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-[var(--r)] border border-line">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-soft">
                      <th className="text-left p-2 font-medium text-text-faint">{t('common.school')}</th>
                      <th className="text-left p-2 font-medium text-text-faint">{t('schoolImport.skippedBecause')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skipped.map((s, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="p-2">{s.row.name || s.row.code}</td>
                        <td className="p-2 text-danger">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={reset}>{t('schoolImport.importAnother')}</Button>
              <Button variant="primary" className="flex-1" onClick={close}>{t('schoolImport.done')}</Button>
            </div>
          </div>
        ) : !parsed ? (
          /* Drop zone */
          <div
            className={cn(
              'border-2 border-dashed rounded-[var(--r-lg)] p-8 text-center transition-all cursor-pointer',
              dragOver ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary',
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            onClick={() => inputRef.current?.click()}
          >
            <p className="font-semibold text-sm text-text">{t('schoolImport.dropHere')}</p>
            <p className="text-xs text-text-dim mt-1">{t('excel.orBrowse')}</p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>
        ) : (
          /* Preview */
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-success font-semibold">{validRows.length} {t('excel.valid')}</span>
              {errorRows.length > 0 && <span className="text-danger font-semibold">{errorRows.length} {t('schoolImport.withErrors')}</span>}
            </div>

            <div className="max-h-60 overflow-y-auto rounded-[var(--r)] border border-line">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="text-left p-2 font-medium text-text-faint">{t('schoolImport.code')}</th>
                    <th className="text-left p-2 font-medium text-text-faint">{t('common.school')}</th>
                    <th className="text-left p-2 font-medium text-text-faint">PPD</th>
                    <th className="text-left p-2 font-medium text-text-faint">{t('common.state')}</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className={cn('border-t border-line', r._error && 'bg-danger/5')}>
                      <td className="p-2 font-mono">{r.code || '—'}</td>
                      <td className="p-2">{r.name || '—'}</td>
                      <td className="p-2 text-text-dim">{r.pld_name || '—'}</td>
                      <td className="p-2 text-text-dim">{r.state_name || '—'}</td>
                      <td className="p-2 text-right">
                        {r._error
                          ? <span className="text-danger" title={r._error}>✗</span>
                          : <span className="text-success">✓</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 100 && (
                <p className="text-xs text-text-faint text-center p-2">{t('excel.showingFirst', { total: rows.length })}</p>
              )}
            </div>

            <p className="text-[11px] text-text-faint">
              {t('schoolImport.matchingHint')}
            </p>

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={reset} disabled={importMutation.isPending}>{t('common.clear')}</Button>
              <Button
                variant="primary"
                className="flex-1"
                disabled={!validRows.length}
                loading={importMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                {t('schoolImport.importCount', { count: validRows.length })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
