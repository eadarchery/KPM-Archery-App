import { useState, useRef, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  parseTrainingExcel,
  downloadTrainingTemplate,
  type TrainingRow,
} from '@/services/excel'
import { bulkInsertTrainingLogs } from '@/services/training'
import { supabase } from '@/services/supabase'
import { cn } from '@/utils/cn'

interface ExcelUploaderProps {
  open:    boolean
  onClose: () => void
  mode:    'training' | 'score'
}

export function ExcelUploader({ open, onClose, mode }: ExcelUploaderProps) {
  const { profile } = useAuth()
  const { t }       = useLanguage()
  const toast       = useToast()
  const queryClient = useQueryClient()
  const inputRef    = useRef<HTMLInputElement>(null)

  const [rows, setRows]         = useState<TrainingRow[]>([])
  const [parsed, setParsed]     = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const archerCodes = useMemo(
    () => [...new Set(rows.filter(row => !row._error).map(row => row.archer_id).filter(Boolean))],
    [rows],
  )

  // Resolve only codes present in the uploaded file. Loading the full archer
  // directory here would become an accidental 400k-row query at national scale.
  const { data: archerMap = {} } = useQuery<Record<string, string>>({
    queryKey: ['archer-id-map', archerCodes],
    queryFn: async () => {
      const map: Record<string, string> = {}
      for (let start = 0; start < archerCodes.length; start += 200) {
        const batch = archerCodes.slice(start, start + 200)
        const { data, error } = await supabase
          .from('profiles')
          .select('id, archer_id')
          .eq('role', 'archer')
          .in('archer_id', batch)
        if (error) throw error
        for (const p of data ?? []) if (p.archer_id) map[p.archer_id] = p.id
      }
      return map
    },
    enabled: open && parsed && archerCodes.length > 0,
    staleTime: 5 * 60_000,
  })

  async function handleFile(file: File) {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.err(t('excel.invalidFile'), t('excel.invalidFileHint'))
      return
    }
    try {
      const parsed = await parseTrainingExcel(file)
      setRows(parsed)
      setParsed(true)
    } catch (err: any) {
      toast.err(t('excel.parseFailed'), err.message)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const validRows   = rows.filter((r) => !r._error && archerMap[r.archer_id])
  const errorRows   = rows.filter((r) => r._error || !archerMap[r.archer_id])
  const unknownRows = rows.filter((r) => !r._error && !archerMap[r.archer_id])

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Not logged in')
      const mapped = validRows.map((r) => ({
        archer_id:    archerMap[r.archer_id],
        date:         r.date,
        arrows_shot:  r.arrows_shot,
        session_type: r.session_type,
        notes:        r.notes,
      }))
      return bulkInsertTrainingLogs(mapped, 'excel')
    },
    onSuccess: (data) => {
      toast.ok(t('excel.imported'), t('excel.importedHint', { count: data.length }))
      queryClient.invalidateQueries({ queryKey: ['my-training'] })
      queryClient.invalidateQueries({ queryKey: ['admin1-overview-stats'] })
      setRows([])
      setParsed(false)
      onClose()
    },
    onError: (err: Error) => {
      toast.err(t('excel.importFailed'), err.message)
    },
  })

  function reset() {
    setRows([])
    setParsed(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title={t('excel.title')} width="min(720px,100%)">
      <div className="space-y-4">
        {/* Template download */}
        <div className="flex items-center justify-between p-3 rounded-[var(--r)] bg-surface-soft border border-line">
          <div>
            <div className="font-semibold text-sm">{t('excel.downloadTemplate')}</div>
            <div className="text-xs text-text-dim">{t('excel.templateHint')}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadTrainingTemplate}
          >
            <DownloadIcon /> {t('common.template')}
          </Button>
        </div>

        {!parsed ? (
          /* Drop zone */
          <div
            className={cn(
              'border-2 border-dashed rounded-[var(--r-lg)] p-8 text-center transition-all cursor-pointer',
              dragOver ? 'border-primary bg-primary-soft' : 'border-line hover:border-primary',
            )}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <UploadIcon className="w-10 h-10 text-text-faint mx-auto mb-3" />
            <p className="font-semibold text-sm text-text">{t('excel.dropHere')}</p>
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
          /* Preview table */
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-ok font-semibold">{validRows.length} {t('excel.valid')}</span>
              {errorRows.length > 0 && <span className="text-danger font-semibold">{errorRows.length} {t('excel.errors')}</span>}
              {unknownRows.length > 0 && <span className="text-warn font-semibold">{unknownRows.length} {t('excel.unknownIds')}</span>}
            </div>

            <div className="table-wrap max-h-60 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left p-2 text-text-faint font-medium">{t('excel.archerId')}</th>
                    <th className="text-left p-2 text-text-faint font-medium">{t('common.date')}</th>
                    <th className="text-right p-2 text-text-faint font-medium">{t('common.arrows')}</th>
                    <th className="text-left p-2 text-text-faint font-medium">{t('common.type')}</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((row, i) => {
                    const hasError   = !!row._error
                    const isUnknown  = !row._error && !archerMap[row.archer_id]
                    return (
                      <tr
                        key={i}
                        className={cn(
                          'border-t border-line',
                          hasError || isUnknown ? 'bg-danger/5' : '',
                        )}
                      >
                        <td className="p-2 font-mono text-xs">{row.archer_id}</td>
                        <td className="p-2">{row.date}</td>
                        <td className="p-2 text-right">{row.arrows_shot}</td>
                        <td className="p-2 text-text-dim">{row.session_type ?? '—'}</td>
                        <td className="p-2 text-right">
                          {hasError  && <span className="text-danger text-xs" title={row._error}>✗ {t('excel.error')}</span>}
                          {isUnknown && <span className="text-warn text-xs">? {t('excel.unknownId')}</span>}
                          {!hasError && !isUnknown && <span className="text-ok text-xs">✓</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {rows.length > 100 && (
                <p className="text-xs text-text-faint text-center p-2">
                  {t('excel.showingFirst', { total: rows.length })}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={reset}>
                {t('common.clear')}
              </Button>
              <Button
                variant="primary"
                className="flex-1"
                disabled={!validRows.length}
                loading={importMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                {t('excel.importRows', { count: validRows.length })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
}

function UploadIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
}
