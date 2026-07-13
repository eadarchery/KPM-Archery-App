import { useState, useMemo, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import {
  Button,
  StatCard,
  Badge,
  Modal,
  ConfirmDialog,
  Input,
  Textarea,
  Select,
  useToast,
  HelpTip,
} from '@/components/ui'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { getAllAchievementDefs, createAchievementDef, updateAchievementDef, uploadBadgeImage, recheckScoreAchievements } from '@/services/achievements'
import { writeAuditLog } from '@/services/auditLog'
import { cn } from '@/utils/cn'
import type { AchievementDef, AchievementCategory } from '@/types'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

type TabKey = 'all' | 'score' | 'practice' | 'tournament' | 'inactive'

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'all',        labelKey: 'common.all'        },
  { key: 'score',      labelKey: 'adminAch.catScore'      },
  { key: 'practice',   labelKey: 'adminAch.catPractice'   },
  { key: 'tournament', labelKey: 'adminAch.catTournament' },
  { key: 'inactive',   labelKey: 'status.inactive'   },
]

const CATEGORY_KEYS: { value: AchievementCategory; labelKey: string }[] = [
  { value: 'score',      labelKey: 'adminAch.catScore'      },
  { value: 'practice',   labelKey: 'adminAch.catPractice'   },
  { value: 'tournament', labelKey: 'adminAch.catTournament' },
  { value: 'coaching',   labelKey: 'adminAch.catCoaching' },
]

const SLUG_PATTERN = /^[a-z0-9_-]+$/

type Translate = (key: string, vars?: Record<string, string | number>) => string

// ─── FORM STATE ──────────────────────────────────────────────────────────────

interface FormState {
  name: string
  slug: string
  description: string
  category: AchievementCategory
  threshold: string
  max_score: string
  distance_m: string
  round_category: string   // '' = any round type
  icon: string
  display_order: string
  active: boolean
  badge_light_url: string
  badge_dark_url: string
}

type FormErrors = Partial<Record<keyof FormState, string>>

const BLANK_FORM: FormState = {
  name:           '',
  slug:           '',
  description:    '',
  category:       'score',
  threshold:      '',
  max_score:      '',
  distance_m:     '',
  round_category: '',
  icon:           '',
  display_order:  '0',
  active:         true,
  badge_light_url: '',
  badge_dark_url:  '',
}

const ROUND_CATEGORY_OPT_KEYS = [
  { value: '',           labelKey: 'adminAch.anyRoundType' },
  { value: 'tournament', labelKey: 'adminAch.tournamentOnly' },
  { value: 'practice',   labelKey: 'adminAch.practiceOnly' },
]

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '')
}

function defToForm(def: AchievementDef): FormState {
  return {
    name:           def.name,
    slug:           def.slug,
    description:    def.description,
    category:       def.category,
    threshold:      def.threshold != null ? String(def.threshold) : '',
    max_score:      (def as { max_score?: number | null }).max_score != null ? String((def as { max_score?: number | null }).max_score) : '',
    distance_m:     def.distance_m != null ? String(def.distance_m) : '',
    round_category: def.round_category ?? '',
    icon:           def.icon ?? '',
    display_order:  String(def.display_order ?? 0),
    active:         def.active,
    badge_light_url: def.badge_light_url ?? '',
    badge_dark_url:  def.badge_dark_url  ?? '',
  }
}

function validateForm(f: FormState, t: Translate): FormErrors {
  const e: FormErrors = {}
  if (!f.name.trim())                      e.name = t('adminAch.errName')
  if (!f.slug.trim())                      e.slug = t('adminAch.errSlug')
  else if (!SLUG_PATTERN.test(f.slug))     e.slug = t('adminAch.errSlugFormat')
  if (!f.description.trim())               e.description = t('adminAch.errDescription')
  if (f.category !== 'tournament') {
    const th = Number(f.threshold)
    if (!f.threshold.trim() || isNaN(th) || th <= 0) e.threshold = t('adminAch.errThreshold')
  }
  if (f.category === 'score') {
    const m = Number(f.max_score)
    if (!f.max_score.trim() || isNaN(m) || m <= 0) {
      e.max_score = t('adminAch.errMaxScore')
    } else if (f.threshold.trim() && Number(f.threshold) > m) {
      e.max_score = t('adminAch.errMaxScoreGte')
    }
    if (f.distance_m.trim()) {
      const dist = Number(f.distance_m)
      if (isNaN(dist) || dist <= 0) e.distance_m = t('adminAch.errDistance')
    }
  }
  return e
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function Admin2Achievements() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const qc = useQueryClient()

  const [tab, setTab]         = useState<TabKey>('all')
  const [search, setSearch]   = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AchievementDef | null>(null)
  const [form, setForm]       = useState<FormState>(BLANK_FORM)
  const [errors, setErrors]   = useState<FormErrors>({})
  const [lightFile, setLightFile] = useState<File | null>(null)
  const [darkFile, setDarkFile]   = useState<File | null>(null)
  const [lightPreview, setLightPreview] = useState<string | null>(null)
  const [darkPreview, setDarkPreview]   = useState<string | null>(null)
  const [saving, setSaving]   = useState(false)
  const [confirmToggle, setConfirmToggle] = useState<{ def: AchievementDef; nextActive: boolean } | null>(null)
  const [toggling, setToggling] = useState(false)
  const [confirmRecheck, setConfirmRecheck] = useState(false)
  const [rechecking, setRechecking] = useState(false)

  // Revoke stale grants + grant newly-qualifying ones after threshold/max edits.
  async function handleRecheck() {
    setRechecking(true)
    try {
      const revoked = await recheckScoreAchievements()
      ok(t('adminAch.recheckComplete', { revoked }))
      writeAuditLog(profile?.id ?? '', 'achievement.rechecked_all', 'achievement', 'bulk', { revoked }).catch(console.warn)
      qc.invalidateQueries({ queryKey: ['achievement-defs-admin'] })
      qc.invalidateQueries({ queryKey: ['achievement-defs'] })
      qc.invalidateQueries({ queryKey: ['user-achievements'] })
      qc.invalidateQueries({ queryKey: ['coach-all-earned'] })
    } catch (e: unknown) {
      err(e instanceof Error ? e.message : t('adminAch.recheckFailed'))
    } finally {
      setRechecking(false)
      setConfirmRecheck(false)
    }
  }

  const lightRef = useRef<HTMLInputElement>(null)
  const darkRef  = useRef<HTMLInputElement>(null)

  // ── Data ─────────────────────────────────────────────────────────────────

  const { data: defs = [], isLoading, isError } = useQuery<AchievementDef[]>({
    queryKey: ['achievement-defs-admin'],
    queryFn: getAllAchievementDefs,
  })

  // ── Derived stats ─────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    active:     defs.filter((d) => d.active).length,
    score:      defs.filter((d) => d.active && d.category === 'score').length,
    practice:   defs.filter((d) => d.active && d.category === 'practice').length,
    tournament: defs.filter((d) => d.active && d.category === 'tournament').length,
    inactive:   defs.filter((d) => !d.active).length,
  }), [defs])

  // ── Filtered list ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return defs.filter((d) => {
      if (tab === 'inactive' && d.active)         return false
      if (tab === 'score'    && d.category !== 'score')      return false
      if (tab === 'practice' && d.category !== 'practice')   return false
      if (tab === 'tournament' && d.category !== 'tournament') return false
      if (tab !== 'inactive' && tab !== 'all' && !d.active)  return false
      if (!q) return true
      return (
        d.name.toLowerCase().includes(q) ||
        d.slug.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        String(d.threshold ?? '').includes(q)
      )
    })
  }, [defs, tab, search])

  // ── Modal helpers ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null)
    setForm(BLANK_FORM)
    setErrors({})
    setLightFile(null)
    setDarkFile(null)
    setLightPreview(null)
    setDarkPreview(null)
    setModalOpen(true)
  }

  function openEdit(def: AchievementDef) {
    setEditTarget(def)
    setForm(defToForm(def))
    setErrors({})
    setLightFile(null)
    setDarkFile(null)
    setLightPreview(null)
    setDarkPreview(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditTarget(null)
  }

  // ── Form field handler ────────────────────────────────────────────────────

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      // Auto-slug only when creating and name hasn't been manually overridden
      if (key === 'name' && !editTarget) {
        next.slug = slugify(value as string)
      }
      return next
    })
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }, [editTarget])

  // ── Image file picker ─────────────────────────────────────────────────────

  function handleFileChange(kind: 'light' | 'dark', file: File | null) {
    if (!file) return
    if (file.type !== 'image/png') {
      err(t('adminAch.onlyPng'))
      return
    }
    const url = URL.createObjectURL(file)
    if (kind === 'light') { setLightFile(file); setLightPreview(url) }
    else                  { setDarkFile(file);  setDarkPreview(url)  }
  }

  // ── Save (create / update) ────────────────────────────────────────────────

  async function handleSave() {
    const errs = validateForm(form, t)
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSaving(true)
    try {
      let lightUrl = form.badge_light_url
      let darkUrl  = form.badge_dark_url

      if (lightFile) lightUrl = await uploadBadgeImage(lightFile, form.slug, 'light')
      if (darkFile)  darkUrl  = await uploadBadgeImage(darkFile,  form.slug, 'dark')

      const threshold = form.threshold.trim() ? Number(form.threshold) : undefined
      // Score badges must carry the round total they apply to; other categories don't use it.
      const maxScore = form.category === 'score' && form.max_score.trim() ? Number(form.max_score) : null
      const distanceM = form.category === 'score' && form.distance_m.trim() ? Number(form.distance_m) : null
      const roundCategory = form.category === 'score' && form.round_category
        ? (form.round_category as 'tournament' | 'practice') : null

      const createPayload = {
        name:           form.name.trim(),
        slug:           form.slug.trim(),
        description:    form.description.trim(),
        category:       form.category,
        threshold:      threshold ?? null,
        max_score:      maxScore,
        distance_m:     distanceM,
        round_category: roundCategory,
        icon:           form.icon.trim() || undefined,
        display_order:  Number(form.display_order) || 0,
        active:         form.active,
        badge_light_url: lightUrl || undefined,
        badge_dark_url:  darkUrl  || undefined,
      }

      const updatePayload: Partial<AchievementDef> = {
        name:           form.name.trim(),
        slug:           form.slug.trim(),
        description:    form.description.trim(),
        category:       form.category,
        threshold,
        max_score:      maxScore,
        distance_m:     distanceM,
        round_category: roundCategory,
        icon:           form.icon.trim() || undefined,
        display_order:  Number(form.display_order) || 0,
        active:         form.active,
        badge_light_url: lightUrl || undefined,
        badge_dark_url:  darkUrl  || undefined,
      }

      if (editTarget) {
        await updateAchievementDef(editTarget.id, updatePayload)
        await writeAuditLog(profile!.id, 'achievement.updated', 'achievement_definition', editTarget.id, { slug: form.slug })
        ok(t('adminAch.updated'))
      } else {
        const created = await createAchievementDef(createPayload)
        await writeAuditLog(profile!.id, 'achievement.created', 'achievement_definition', created.id, { slug: form.slug })
        ok(t('adminAch.created'))
      }

      qc.invalidateQueries({ queryKey: ['achievement-defs-admin'] })
      qc.invalidateQueries({ queryKey: ['achievement-defs'] })
      closeModal()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('common.unknown')
      err(t('adminAch.saveFailed'), msg)
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle active/inactive ────────────────────────────────────────────────

  async function handleToggleActive() {
    if (!confirmToggle) return
    const { def, nextActive } = confirmToggle
    setToggling(true)
    try {
      await updateAchievementDef(def.id, { active: nextActive })
      await writeAuditLog(
        profile!.id,
        nextActive ? 'achievement.activated' : 'achievement.deactivated',
        'achievement_definition',
        def.id,
        { slug: def.slug },
      )
      qc.invalidateQueries({ queryKey: ['achievement-defs-admin'] })
      qc.invalidateQueries({ queryKey: ['achievement-defs'] })
      ok(nextActive ? t('adminAch.activated') : t('adminAch.deactivated'))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('common.unknown')
      err(t('adminAch.toggleFailed'), msg)
    } finally {
      setToggling(false)
      setConfirmToggle(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageWrapper>
      <PageHead
        title={t('adminAch.title')}
        description={t('adminAch.description')}
        action={
          <div className="flex items-center gap-2">
            <HelpTip
              title={t('helpTips.recheckBadges.title')}
              what={t('helpTips.recheckBadges.what')}
              who={t('helpTips.recheckBadges.who')}
              reversible={t('helpTips.recheckBadges.reversible')}
              warning={t('helpTips.recheckBadges.warning')}
              align="right"
            />
            <Button variant="secondary" onClick={() => setConfirmRecheck(true)} disabled={rechecking}>
              {rechecking ? t('adminAch.rechecking') : t('adminAch.recheckBadges')}
            </Button>
            <Button onClick={openCreate} icon={<PlusIcon />}>{t('adminAch.newAchievement')}</Button>
          </div>
        }
      />

      <ConfirmDialog
        open={confirmRecheck}
        onClose={() => { if (!rechecking) setConfirmRecheck(false) }}
        onConfirm={handleRecheck}
        loading={rechecking}
        title={t('adminAch.recheckTitle')}
        message={t('adminAch.recheckMessage')}
        confirmLabel={t('adminAch.recheckNow')}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <StatCard label={t('status.active')}     value={stats.active}     />
        <StatCard label={t('adminAch.catScore')}      value={stats.score}      />
        <StatCard label={t('adminAch.catPractice')}   value={stats.practice}   />
        <StatCard label={t('adminAch.catTournament')} value={stats.tournament} />
        <StatCard label={t('status.inactive')}   value={stats.inactive}   />
      </div>

      <SectionCard>
        {/* Search + Tabs */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <Input
            placeholder={t('adminAch.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            wrapperClassName="flex-1"
          />
        </div>

        {/* Tab strip */}
        <div className="flex gap-1 mb-5 border-b border-line overflow-x-auto">
          {TABS.map((tabDef) => (
            <button
              key={tabDef.key}
              onClick={() => setTab(tabDef.key)}
              className={cn(
                'px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors',
                tab === tabDef.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-dim hover:text-text',
              )}
            >
              {t(tabDef.labelKey)}
            </button>
          ))}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="text-center py-12 text-text-dim text-sm">{t('adminAch.loading')}</div>
        ) : isError ? (
          <EmptyState title={t('adminAch.loadFailed')} description={t('adminAch.loadFailedHint')} icon="⚠️" />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t('adminAch.noneFound')}
            description={search ? t('adminAch.tryDifferentSearch') : t('adminAch.createFirstHint')}
            icon="🏅"
            action={<Button onClick={openCreate} size="sm">{t('adminAch.newAchievement')}</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((def) => (
              <AchievementCard
                key={def.id}
                def={def}
                onEdit={() => openEdit(def)}
                onToggle={() => setConfirmToggle({ def, nextActive: !def.active })}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editTarget ? t('adminAch.editAchievement') : t('adminAch.newAchievement')}
        width="min(720px,100%)"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5 gap-y-4">
          {/* Left column: fields */}
          <div className="flex flex-col gap-4">
            <Input
              label={t('adminAch.nameLabel')}
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              error={errors.name}
              placeholder={t('adminAch.namePlaceholder')}
            />
            <Input
              label={t('adminAch.slugLabel')}
              value={form.slug}
              onChange={(e) => setField('slug', e.target.value.toLowerCase())}
              error={errors.slug}
              placeholder={t('adminAch.slugPlaceholder')}
              hint={t('adminAch.slugHint')}
            />
            <Textarea
              label={t('adminAch.descriptionLabel')}
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              error={errors.description}
              minRows={2}
              placeholder={t('adminAch.descriptionPlaceholder')}
            />
            <Select
              label={t('adminAch.categoryLabel')}
              value={form.category}
              onChange={(e) => setField('category', e.target.value as AchievementCategory)}
              options={CATEGORY_KEYS.map(c => ({ value: c.value, label: t(c.labelKey) }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={form.category === 'tournament' ? t('adminAch.thresholdOptional') : t('adminAch.thresholdRequired')}
                value={form.threshold}
                onChange={(e) => setField('threshold', e.target.value)}
                error={errors.threshold}
                type="number"
                min={1}
                placeholder="e.g. 300"
              />
              <Input
                label={t('adminAch.displayOrder')}
                value={form.display_order}
                onChange={(e) => setField('display_order', e.target.value)}
                type="number"
                min={0}
                placeholder="0"
              />
            </div>
            {form.category === 'coaching' && (
              <p className="text-[11px] text-text-dim bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">
                {t('adminAch.coachingSlugHint')}
              </p>
            )}
            {form.category === 'score' && (
              <>
                <Input
                  label={t('adminAch.roundMaxLabel')}
                  value={form.max_score}
                  onChange={(e) => setField('max_score', e.target.value)}
                  error={errors.max_score}
                  type="number"
                  min={1}
                  placeholder="e.g. 360"
                  hint={t('adminAch.roundMaxHint')}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={t('roundsPage.distanceM')}
                    value={form.distance_m}
                    onChange={(e) => setField('distance_m', e.target.value)}
                    error={errors.distance_m}
                    type="number"
                    min={1}
                    placeholder="e.g. 70"
                    hint={t('adminAch.distanceHint')}
                  />
                  <Select
                    label={t('adminAch.roundType')}
                    value={form.round_category}
                    onChange={(e) => setField('round_category', e.target.value)}
                    options={ROUND_CATEGORY_OPT_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
                  />
                </div>
                <p className="text-[11px] text-text-dim bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">
                  {t('adminAch.matchAllHint')}
                </p>
              </>
            )}
            <Input
              label={t('adminAch.iconLabel')}
              value={form.icon}
              onChange={(e) => setField('icon', e.target.value)}
              placeholder="e.g. 🏆"
            />

            {/* Active toggle */}
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <span
                onClick={() => setField('active', !form.active)}
                className={cn(
                  'relative inline-flex w-11 h-6 rounded-full transition-colors duration-200',
                  form.active ? 'bg-primary' : 'bg-line-strong',
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                    form.active ? 'translate-x-6' : 'translate-x-1',
                  )}
                />
              </span>
              <span className="text-sm font-semibold text-text">{form.active ? t('status.active') : t('status.inactive')}</span>
            </label>
          </div>

          {/* Right column: images + preview */}
          <div className="flex flex-col gap-4">
            {/* Badge preview */}
            <div>
              <p className="text-[12px] font-semibold text-text-dim mb-2">{t('common.preview')}</p>
              <div className="flex gap-3">
                <BadgePreviewCard
                  label={t('adminAch.lightMode')}
                  imageUrl={lightPreview ?? form.badge_light_url}
                  emoji={form.icon}
                  name={form.name || t('adminAch.namePlaceholder2')}
                />
                <BadgePreviewCard
                  label={t('adminAch.darkMode')}
                  imageUrl={darkPreview ?? form.badge_dark_url}
                  emoji={form.icon}
                  name={form.name || t('adminAch.namePlaceholder2')}
                  dark
                />
              </div>
            </div>

            {/* Light PNG upload */}
            <div>
              <p className="text-[12px] font-semibold text-text-dim mb-1.5">{t('adminAch.lightPng')}</p>
              <input
                ref={lightRef}
                type="file"
                accept="image/png"
                className="hidden"
                onChange={(e) => handleFileChange('light', e.target.files?.[0] ?? null)}
              />
              <div className="flex gap-2 items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => lightRef.current?.click()}
                  icon={<UploadIcon />}
                >
                  {form.badge_light_url || lightFile ? t('adminAch.replaceLight') : t('adminAch.uploadLight')}
                </Button>
                {(lightPreview || form.badge_light_url) && (
                  <span className="text-xs text-success font-medium">✓ {t('adminAch.set')}</span>
                )}
              </div>
              {lightFile && (
                <p className="text-[11px] text-text-dim mt-1">{lightFile.name}</p>
              )}
            </div>

            {/* Dark PNG upload */}
            <div>
              <p className="text-[12px] font-semibold text-text-dim mb-1.5">{t('adminAch.darkPng')}</p>
              <input
                ref={darkRef}
                type="file"
                accept="image/png"
                className="hidden"
                onChange={(e) => handleFileChange('dark', e.target.files?.[0] ?? null)}
              />
              <div className="flex gap-2 items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => darkRef.current?.click()}
                  icon={<UploadIcon />}
                >
                  {form.badge_dark_url || darkFile ? t('adminAch.replaceDark') : t('adminAch.uploadDark')}
                </Button>
                {(darkPreview || form.badge_dark_url) && (
                  <span className="text-xs text-success font-medium">✓ {t('adminAch.set')}</span>
                )}
              </div>
              {darkFile && (
                <p className="text-[11px] text-text-dim mt-1">{darkFile.name}</p>
              )}
            </div>

            <p className="text-[11px] text-text-faint">{t('adminAch.pngNote')}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end mt-6 pt-4 border-t border-line">
          <Button variant="ghost" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} loading={saving}>
            {editTarget ? t('common.saveChanges') : t('adminAch.createAchievement')}
          </Button>
        </div>
      </Modal>

      {/* Confirm toggle dialog */}
      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={handleToggleActive}
        loading={toggling}
        destructive={confirmToggle?.nextActive === false}
        title={confirmToggle?.nextActive ? t('adminAch.activateTitle') : t('adminAch.deactivateTitle')}
        message={
          confirmToggle?.nextActive
            ? t('adminAch.activateConfirm', { name: confirmToggle.def.name })
            : t('adminAch.deactivateConfirm', { name: confirmToggle?.def.name ?? '' })
        }
        confirmLabel={confirmToggle?.nextActive ? t('common.activate') : t('common.deactivate')}
      />
    </PageWrapper>
  )
}

// ─── ACHIEVEMENT CARD ─────────────────────────────────────────────────────────

function AchievementCard({
  def,
  onEdit,
  onToggle,
}: {
  def: AchievementDef
  onEdit: () => void
  onToggle: () => void
}) {
  const { t } = useLanguage()
  const badgeUrl = def.badge_light_url

  return (
    <div className={cn(
      'rounded-[var(--r-lg)] border p-4 flex gap-3 bg-surface',
      def.active ? 'border-line' : 'border-line opacity-60',
    )}>
      {/* Badge image / emoji */}
      <div className="shrink-0 w-14 h-14 rounded-[10px] border border-line bg-surface-soft flex items-center justify-center overflow-hidden">
        {badgeUrl ? (
          <img src={badgeUrl} alt={def.name} className="w-full h-full object-contain" />
        ) : (
          <span className="text-3xl">{def.icon ?? <ShieldIcon />}</span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-display font-semibold text-[14px] text-text leading-tight truncate">{def.name}</p>
            <p className="text-[11px] text-text-faint font-mono mt-0.5 truncate">{def.slug}</p>
          </div>
          <Badge variant={def.active ? 'success' : 'neutral'} dot>
            {def.active ? t('status.active') : t('status.inactive')}
          </Badge>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <Badge variant="primary">{t(`adminAch.cat${def.category.charAt(0).toUpperCase()}${def.category.slice(1)}`)}</Badge>
          {def.threshold != null && (
            <span className="text-[11px] text-text-dim font-semibold">≥ {def.threshold.toLocaleString()}</span>
          )}
        </div>

        <p className="text-[12px] text-text-dim mt-1.5 line-clamp-2 leading-snug">{def.description}</p>

        <div className="flex gap-1.5 mt-3">
          <Button variant="ghost" size="sm" onClick={onEdit}>{t('common.edit')}</Button>
          <Button
            variant={def.active ? 'warning' : 'success'}
            size="sm"
            onClick={onToggle}
          >
            {def.active ? t('common.deactivate') : t('common.activate')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── BADGE PREVIEW CARD ───────────────────────────────────────────────────────

function BadgePreviewCard({
  label,
  imageUrl,
  emoji,
  name,
  dark = false,
}: {
  label: string
  imageUrl?: string
  emoji?: string
  name: string
  dark?: boolean
}) {
  return (
    <div className="flex-1">
      <p className="text-[10px] text-text-faint mb-1.5 uppercase tracking-wide font-semibold">{label}</p>
      <div className={cn(
        'rounded-[var(--r)] border p-3 text-center flex flex-col items-center gap-1.5',
        dark ? 'bg-[#0f0f0f] border-[#333]' : 'bg-white border-[#e5e7eb]',
      )}>
        <div className="w-12 h-12 flex items-center justify-center">
          {imageUrl ? (
            <img src={imageUrl} alt={name} className="w-full h-full object-contain" />
          ) : (
            <span className="text-3xl">{emoji || '🏅'}</span>
          )}
        </div>
        <p className={cn('text-[11px] font-semibold leading-tight line-clamp-2', dark ? 'text-white' : 'text-gray-800')}>
          {name}
        </p>
      </div>
    </div>
  )
}

// ─── ICONS ───────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-faint">
      <path d="M12 2l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V5z"/>
    </svg>
  )
}
