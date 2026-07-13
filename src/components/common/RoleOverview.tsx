import { useNavigate } from 'react-router-dom'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Badge, Button } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { ROLE_HIERARCHY, ROLE_SECTIONS, ROLE_HOME_PATH } from '@/lib/roleConfig'
import type { Role } from '@/types'

/**
 * Read-only reference of every role: what it is for, where it lands, which
 * sections it may enter, and a plain-language capability summary.
 *
 * This is intentionally NOT editable. Role permissions are configured in ONE
 * place — the Super Admin Role Permissions manager (/super-admin/role-permissions).
 * This component is reused by:
 *   • /super-admin/roles   → with `canEdit` (shows a shortcut to the editor)
 *   • /admin2/roles        → read-only (Admin 2 may view, never edit)
 *
 * Structural labels, role names and section names are translated (BM/EN). The
 * per-role descriptive prose below is English for now (see docs — deeper i18n
 * cleanup), since it is reference copy rather than interactive UI.
 */

// Per-role summary + capability list, resolved from i18n at render time.
// Each role has a `.summary` and a `.caps` array under `roleInfo.<role>`.
const ROLE_INFO_CAP_COUNT: Record<Role, number> = {
  archer: 4, coach: 4, admin1: 4, admin2: 4, super_admin: 4,
}

export function RoleOverview({ canEdit = false }: { canEdit?: boolean }) {
  const navigate = useNavigate()
  const { t } = useLanguage()

  // Translate a section key to its display label (role names + Articles).
  const sectionLabel = (s: string) => (s === 'articles' ? t('nav.articles') : t('roles.' + s))

  // Show the most privileged role first for a top-down read.
  const roles = [...ROLE_HIERARCHY].reverse()

  return (
    <PageWrapper>
      <PageHead
        title={t('roleOverview.title')}
        description={t('roleOverview.description')}
        action={
          canEdit ? (
            <Button variant="primary" size="sm" onClick={() => navigate('/super-admin/role-permissions')}>
              {t('roleOverview.openEditor')}
            </Button>
          ) : undefined
        }
      />

      <SectionCard className="mb-4">
        <p className="text-sm text-text-dim leading-relaxed">{t('roleOverview.readOnlyNote')}</p>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {roles.map((r, idx) => {
          const summary = t(`roleInfo.${r}.summary`)
          const capabilities = Array.from({ length: ROLE_INFO_CAP_COUNT[r] }, (_, i) => t(`roleInfo.${r}.cap${i + 1}`))
          const rank = ROLE_HIERARCHY.indexOf(r) + 1
          return (
            <div key={r} className="rounded-[var(--r-lg)] border border-line bg-surface p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-semibold text-text">{t('roles.' + r)}</h3>
                    {idx === 0 && <Badge variant="primary" className="text-[9px]">{t('roleOverview.highest')}</Badge>}
                  </div>
                  <p className="text-xs text-text-dim leading-relaxed mt-1">{summary}</p>
                </div>
                <Badge variant="neutral" className="text-[10px] flex-shrink-0">{t('roleOverview.tier', { n: rank })}</Badge>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[.05em] text-text-faint mb-1.5">{t('roleOverview.defaultLanding')}</div>
                <code className="text-[11px] text-text-dim break-all">{ROLE_HOME_PATH[r]}</code>
              </div>

              <div>
                <div className="text-[11px] uppercase tracking-[.05em] text-text-faint mb-1.5">{t('roleOverview.sections')}</div>
                <div className="flex flex-wrap gap-1.5">
                  {ROLE_SECTIONS[r].map((s) => (
                    <Badge key={s} variant="neutral" className="text-[10px]">
                      {sectionLabel(s)}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="mt-auto pt-1">
                <div className="text-[11px] uppercase tracking-[.05em] text-text-faint mb-1.5">{t('roleOverview.capabilities')}</div>
                <ul className="space-y-1">
                  {capabilities.map((c) => (
                    <li key={c} className="text-xs text-text-dim flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">•</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )
        })}
      </div>
    </PageWrapper>
  )
}
