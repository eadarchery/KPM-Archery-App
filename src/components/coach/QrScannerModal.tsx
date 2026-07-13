import { useEffect, useRef, useState } from 'react'
import type { Html5Qrcode } from 'html5-qrcode'
import { Modal } from '@/components/ui/Modal'
import { useLanguage } from '@/contexts/LanguageContext'

/**
 * Camera QR scanner for coach→archer linking. Reads the archer profile QR
 * (JSON `{type:'archer_profile', archer_id, …}`) or a plain Archer ID and
 * hands the decoded code to the caller. Uses the rear camera on phones.
 *
 * html5-qrcode (~330 kB) is imported lazily so it only downloads the first
 * time the scanner is actually opened.
 */
export function QrScannerModal({
  open,
  onClose,
  onScan,
}: {
  open: boolean
  onClose: () => void
  onScan: (archerCode: string) => void
}) {
  const { t } = useLanguage()
  const [error, setError] = useState('')
  const handled = useRef(false)

  useEffect(() => {
    if (!open) return
    handled.current = false
    setError('')

    let scanner: Html5Qrcode | null = null
    let started = false
    let cancelled = false

    import('html5-qrcode')
      .then(({ Html5Qrcode }) => {
        if (cancelled) return
        scanner = new Html5Qrcode('coach-qr-reader')
        return scanner
          .start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            (text) => {
              if (handled.current) return
              handled.current = true
              // The archer QR carries JSON; a plain ID string also works.
              let code = text.trim()
              try {
                const parsed = JSON.parse(text) as { archer_id?: string }
                if (parsed?.archer_id) code = parsed.archer_id
              } catch { /* not JSON — treat as raw code */ }
              onScan(code)
            },
            () => {}, // per-frame decode misses — ignore
          )
          .then(() => { started = true })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const msg = String((e as Error)?.message ?? e)
        setError(
          /NotAllowedError|Permission/i.test(msg)
            ? t('qrScanner.cameraBlocked')
            : t('qrScanner.cameraFailed'),
        )
      })

    return () => {
      cancelled = true
      if (scanner) {
        if (started) scanner.stop().then(() => scanner!.clear()).catch(() => {})
        else try { scanner.clear() } catch { /* never started */ }
      }
    }
    // onScan is stable enough for the modal's lifetime; re-running on its
    // identity would restart the camera every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Modal open={open} onClose={onClose} title={t('qrScanner.title')} width="min(420px,100%)">
      <div id="coach-qr-reader" className="rounded-[var(--r-md)] overflow-hidden bg-black min-h-[240px]" />
      {error ? (
        <p className="text-sm text-danger mt-3">{error}</p>
      ) : (
        <p className="text-xs text-text-dim mt-3">
          {t('qrScanner.hint')}
        </p>
      )}
    </Modal>
  )
}
