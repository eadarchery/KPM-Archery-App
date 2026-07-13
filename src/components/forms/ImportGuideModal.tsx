import { useState } from 'react'
import { Modal, Button } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  downloadSchoolTemplate, downloadCoachTemplate,
  downloadArcherTemplate, downloadAdminTemplate,
} from '@/services/excel'
import { cn } from '@/utils/cn'

/**
 * Import templates & validation guide for bulk setup (Admin 2).
 *
 * One place to download the school / coach / archer / admin templates and
 * read, per template: required fields, optional fields, accepted formats,
 * validation rules, duplicate handling and error-message guidance — so files
 * are prepared correctly BEFORE upload. All copy lives in `importGuide.*`
 * (English + Bahasa Malaysia).
 */

type TemplateKey = 'schools' | 'coaches' | 'archers' | 'admins'

const TEMPLATES: { key: TemplateKey; download: () => void }[] = [
  { key: 'schools', download: downloadSchoolTemplate },
  { key: 'coaches', download: downloadCoachTemplate },
  { key: 'archers', download: downloadArcherTemplate },
  { key: 'admins',  download: downloadAdminTemplate },
]

export function ImportGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage()
  const [active, setActive] = useState<TemplateKey>('schools')

  const tpl = TEMPLATES.find((x) => x.key === active)!

  // Guide rows: label key + content key, rendered as definition rows.
  const rows: { labelKey: string; contentKey: string }[] = [
    { labelKey: 'importGuide.colRequired',   contentKey: `importGuide.${active}.required` },
    { labelKey: 'importGuide.colOptional',   contentKey: `importGuide.${active}.optional` },
    { labelKey: 'importGuide.colFormats',    contentKey: `importGuide.${active}.formats` },
    { labelKey: 'importGuide.colValidation', contentKey: `importGuide.${active}.validation` },
    { labelKey: 'importGuide.colDuplicates', contentKey: `importGuide.${active}.duplicates` },
    { labelKey: 'importGuide.colErrors',     contentKey: `importGuide.${active}.errors` },
  ]

  return (
    <Modal open={open} onClose={onClose} title={t('importGuide.title')} width="min(680px,100%)">
      <div className="space-y-4">
        <p className="text-sm text-text-dim leading-relaxed">{t('importGuide.description')}</p>

        {/* Before-you-upload checklist */}
        <div className="rounded-[var(--r)] border border-line bg-section p-3">
          <p className="text-[12px] font-semibold text-text mb-1.5">{t('importGuide.beforeTitle')}</p>
          <ul className="list-disc pl-4 space-y-1 text-xs text-text-dim leading-relaxed">
            <li>{t('importGuide.before1')}</li>
            <li>{t('importGuide.before2')}</li>
            <li>{t('importGuide.before3')}</li>
            <li>{t('importGuide.before4')}</li>
          </ul>
        </div>

        {/* Template tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TEMPLATES.map(({ key }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border',
                active === key
                  ? 'bg-primary text-primary-on border-primary'
                  : 'bg-section text-text-dim border-line hover:border-primary hover:text-text',
              )}
            >
              {t(`importGuide.${key}.name`)}
            </button>
          ))}
        </div>

        {/* Active template guide */}
        <div className="rounded-[var(--r)] border border-line bg-surface p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="font-display font-semibold text-sm text-text">{t(`importGuide.${active}.name`)}</p>
              <p className="text-xs text-text-dim mt-0.5 leading-relaxed">{t(`importGuide.${active}.intro`)}</p>
            </div>
            <Button variant="primary" size="sm" onClick={tpl.download}>
              ⬇ {t('importGuide.download')}
            </Button>
          </div>

          <dl className="space-y-2.5">
            {rows.map(({ labelKey, contentKey }) => (
              <div key={labelKey}>
                <dt className="text-[11px] font-semibold uppercase tracking-[.05em] text-text-faint">{t(labelKey)}</dt>
                <dd className="text-xs text-text-dim leading-relaxed mt-0.5">{t(contentKey)}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-[11px] text-text-faint leading-relaxed">{t('importGuide.footerNote')}</p>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Modal>
  )
}
