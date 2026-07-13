import { useState, useEffect, type CSSProperties } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRuleValue } from '@/hooks/useSystemRules'
import { submitScore, uploadProofPhoto } from '@/services/scores'
import { ageSnapshot, birthYearFromProfile } from '@/utils/ageGroup'
import { ArrowPlotter, type PlottedArrowCm } from './ArrowPlotter'
import { getFace, scoreBand, BAND_STYLE } from './targetFaces'
import { enqueue } from '@/offline/syncQueue'
import { saveDraft, deleteDraft, loadDraft } from '@/offline/drafts'
import { supabase } from '@/services/supabase'
import { today } from '@/utils/dates'
import { uid } from '@/utils/uid'
import type { Round } from '@/types'

// ─── SCHEMA ──────────────────────────────────────────────────

const schema = z.object({
  round_id:     z.string().min(1, 'Select a round'),
  date:         z.string().min(1, 'Enter a date'),
  session_time: z.string().optional(),
  total_score:  z.coerce.number().int().min(0).max(9999),
  mode:         z.enum(['total', 'per_arrow', 'plot']),
  notes:        z.string().optional(),
})

type FormValues = z.infer<typeof schema>

// ─── PER-ARROW GRID ──────────────────────────────────────────

type ArrowVal = 'M' | 'X' | 1|2|3|4|5|6|7|8|9|10
const ARROW_BUTTONS: ArrowVal[] = ['M', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'X']

function arrowToNum(v: ArrowVal): number {
  if (v === 'M') return 0
  if (v === 'X') return 10
  return v as number
}

/** Real target-face colors for a score value; 'M' is handled via Tailwind
 *  classes at the call site (theme-aware grey, not a ring color). */
function arrowStyle(v: ArrowVal): CSSProperties | undefined {
  if (v === 'M') return undefined
  const band = scoreBand(v)
  const s = BAND_STYLE[band]
  return {
    background: s.fill,
    color: s.text,
    ...(band === 'white' ? { border: `1.5px solid ${s.stroke}` } : {}),
  }
}

interface ArrowGridProps {
  totalArrows: number
  endSize?: number
  onChange: (arrows: ArrowVal[], total: number) => void
}

function ArrowGrid({ totalArrows, endSize: endSizeProp, onChange }: ArrowGridProps) {
  const { t } = useLanguage()
  const [arrows, setArrows] = useState<ArrowVal[]>([])
  // Index of an already-entered arrow the user tapped to edit (null = append).
  const [editIndex, setEditIndex] = useState<number | null>(null)

  const emit = (next: ArrowVal[]) => {
    setArrows(next)
    onChange(next, next.reduce((s, v) => s + arrowToNum(v), 0))
  }

  /** Score button: replaces the selected arrow if one is being edited, else appends. */
  function handleScore(val: ArrowVal) {
    if (editIndex != null) {
      const next = [...arrows]
      next[editIndex] = val
      setEditIndex(null)
      emit(next)
      return
    }
    if (arrows.length >= totalArrows) return
    emit([...arrows, val])
  }

  /** Tap an entered arrow to select it for replacement (tap again to deselect). */
  function selectArrow(index: number) {
    setEditIndex((cur) => (cur === index ? null : index))
  }

  function handleUndo() {
    setEditIndex(null)
    emit(arrows.slice(0, -1))
  }

  const endSize = endSizeProp && endSizeProp > 0 ? endSizeProp : (totalArrows <= 30 ? 3 : 6)
  const scoreDisabled = editIndex == null && arrows.length >= totalArrows

  return (
    <div className="space-y-4">
      {/* Editing banner */}
      {editIndex != null && (
        <div className="flex items-center justify-between gap-2 p-2 rounded-[var(--r)] bg-primary-soft text-sm">
          <span className="text-primary font-semibold">
            {t('scoreEntry.editingArrow', { n: editIndex + 1 })}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditIndex(null)}>
            {t('scoreEntry.cancelEdit')}
          </Button>
        </div>
      )}

      {/* Score buttons */}
      <div className="grid grid-cols-6 gap-2">
        {ARROW_BUTTONS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => handleScore(v)}
            disabled={scoreDisabled}
            style={arrowStyle(v)}
            className={[
              'h-10 rounded-[var(--r)] font-display font-bold text-sm transition-all active:scale-95 hover:brightness-95',
              v === 'M' ? 'bg-surface-soft text-text-dim border border-line' : '',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100',
            ].join(' ')}
          >
            {v}
          </button>
        ))}
      </div>

      <p className="text-[11px] text-text-faint text-center">{t('scoreEntry.tapArrowHint')}</p>

      {/* Arrow display by ends — tap any entered arrow to edit it */}
      <div className="space-y-1.5">
        {Array.from({ length: Math.ceil(arrows.length / endSize) + (arrows.length < totalArrows ? 1 : 0) }).map((_, ei) => {
          const endArrows = arrows.slice(ei * endSize, (ei + 1) * endSize)
          const endTotal  = endArrows.reduce((s, v) => s + arrowToNum(v), 0)
          const isActive  = editIndex == null && ei === Math.floor(arrows.length / endSize) && arrows.length < totalArrows
          return (
            <div
              key={ei}
              className={[
                'flex items-center gap-2 p-2 rounded-[var(--r)]',
                isActive ? 'bg-primary-soft' : 'bg-surface-soft',
              ].join(' ')}
            >
              <span className="text-xs text-text-faint w-12">{t('plotter.end')} {ei + 1}</span>
              <div className="flex gap-1.5 flex-1">
                {Array.from({ length: endSize }).map((_, ai) => {
                  const globalIndex = ei * endSize + ai
                  const arrow = endArrows[ai]
                  const isEditing = editIndex === globalIndex
                  return (
                    <button
                      key={ai}
                      type="button"
                      disabled={arrow === undefined}
                      onClick={() => selectArrow(globalIndex)}
                      style={arrow !== undefined ? arrowStyle(arrow) : undefined}
                      className={[
                        'w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center transition-all hover:brightness-95',
                        isEditing ? 'ring-2 ring-primary ring-offset-1 scale-110' : '',
                        arrow === undefined ? 'border-2 border-dashed border-line text-text-faint cursor-default' :
                        arrow === 'M'       ? 'bg-surface-soft text-text-dim border border-line' : '',
                      ].join(' ')}
                    >
                      {arrow ?? ''}
                    </button>
                  )
                })}
              </div>
              {endArrows.length === endSize && (
                <span className="text-sm font-bold text-primary w-8 text-right">{endTotal}</span>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-text-dim">
          {arrows.length} / {totalArrows} {t('scoreEntry.arrows')}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={handleUndo} disabled={!arrows.length}>
            {t('plotter.undo')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── MAIN FORM ───────────────────────────────────────────────

interface ScoreEntryFormProps {
  open: boolean
  onClose: () => void
  draftId?: string
}

export function ScoreEntryForm({ open, onClose, draftId }: ScoreEntryFormProps) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [proofFile, setProofFile]         = useState<File | null>(null)
  const [arrowsData, setArrowsData]       = useState<ArrowVal[]>([])
  const [perArrowTotal, setPerArrowTotal] = useState(0)
  const [plotData, setPlotData]           = useState<PlottedArrowCm[]>([])
  const [isOffline, setIsOffline]         = useState(!navigator.onLine)

  useEffect(() => {
    const onOnline  = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const { data: rounds = [] } = useQuery<Round[]>({
    queryKey: ['rounds'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rounds')
        .select('*')
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data as Round[]
    },
    enabled: open,
  })

  // The archer's disciplines (bow types they shoot). Rounds are filtered to
  // these, and the submitted score's bow_category is taken from the round.
  const { data: myDisciplines = [] } = useQuery<string[]>({
    queryKey: ['my-disciplines', profile?.id],
    enabled: open && !!profile?.id,
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('disciplines').eq('id', profile!.id).maybeSingle()
      return ((data as { disciplines?: string[] } | null)?.disciplines) ?? []
    },
  })

  // The archer's ACTIVE coach link, if any. Scores are attributed to this coach
  // so a coach-linked archer's scores go to their coach's queue — and an
  // UNLINKED archer's scores get coach_id = null and route to the admin
  // "Needs admin validation" queue instead (Tasks 8/9), never a stale ex-coach.
  const { data: activeCoachId } = useQuery<string | null>({
    queryKey: ['my-active-coach', profile?.id],
    enabled: open && !!profile?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('coach_archer_links')
        .select('coach_id')
        .eq('archer_id', profile!.id)
        .eq('status', 'active')
        .order('approved_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return (data as { coach_id: string } | null)?.coach_id ?? null
    },
  })

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date:  today(),
      session_time: new Date().toTimeString().slice(0, 5),
      mode:  'total',
      total_score: 0,
    },
  })

  const mode       = watch('mode')
  const roundId    = watch('round_id')
  const selectedRound = rounds.find((r) => r.id === roundId)

  // Practice vs Tournament selector — splits the round list so archers pick the
  // kind of session first, then only see rounds of that kind.
  const [roundType, setRoundType] = useState<'practice' | 'tournament'>('practice')
  const roundIsTournamentCat = (r: Round) => (r as { category?: string }).category === 'tournament'

  // A round is offered if it has no disciplines (uncategorised → everyone), or
  // it shares a discipline with the archer. If the archer set no disciplines,
  // nothing is hidden (backward compatible).
  const roundMatchesDiscipline = (r: Round) => {
    const rc = r.bow_categories ?? []
    if (!rc.length || !myDisciplines.length) return true
    return rc.some((c) => myDisciplines.includes(c))
  }
  const filteredRounds = rounds.filter((r) =>
    (roundType === 'tournament' ? roundIsTournamentCat(r) : !roundIsTournamentCat(r))
    && roundMatchesDiscipline(r))

  // The bow_category recorded on the score comes from the ROUND (not the
  // profile): the round's single discipline, else the one matching the archer,
  // else the profile bow as a last-resort fallback.
  const deriveBowCategory = (r: Round): string | null => {
    const rc = r.bow_categories ?? []
    if (rc.length === 1) return rc[0]
    const match = rc.filter((c) => myDisciplines.includes(c))
    if (match.length) return match[0]
    return profile?.bow_category ?? (rc[0] ?? null)
  }

  // Keep the toggle in sync when a round is set from a draft/reset.
  useEffect(() => {
    const r = rounds.find((x) => x.id === roundId)
    if (r) setRoundType(roundIsTournamentCat(r) ? 'tournament' : 'practice')
  }, [roundId, rounds])

  // Tournament rules (system rules; safe defaults if unreadable).
  const archersCanTournament = useRuleValue<boolean>('archers_can_submit_tournament_scores', true)
  const tournamentNeedsProof = useRuleValue<boolean>('tournament_scores_require_proof', true)
  const isTournament = (selectedRound as { category?: string } | undefined)?.category === 'tournament'
  const tournamentBlocked = isTournament && !archersCanTournament
  const proofRequired = isTournament && tournamentNeedsProof

  // Sync per-arrow / plotted total into form
  useEffect(() => {
    if (mode === 'per_arrow' || mode === 'plot') setValue('total_score', perArrowTotal)
  }, [mode, perArrowTotal, setValue])

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!profile) throw new Error('Not logged in')

      const round = rounds.find((r) => r.id === values.round_id)
      if (!round) throw new Error('Invalid round')

      const roundIsTournament = (round as { category?: string }).category === 'tournament'
      // Enforce tournament rules client-side (RLS/validation flow still governs).
      if (roundIsTournament && !archersCanTournament) {
        throw new Error(t('scoreEntry.tournamentBlocked'))
      }
      if (roundIsTournament && tournamentNeedsProof && !proofFile && !isOffline) {
        throw new Error(t('scoreEntry.proofRequiredError'))
      }

      // Freeze the calendar-year age group for this submission (Task 4).
      const snap = ageSnapshot(birthYearFromProfile(profile))

      const payload = {
        archer_id:   profile.id,
        round_id:    values.round_id,
        // Only attribute to an ACTIVE coach; unlinked archers submit with no
        // coach so their score routes to the admin validation queue.
        coach_id:    activeCoachId ?? undefined,
        date:         values.date,
        session_time: values.session_time || null,
        total_score:  values.total_score,
        max_score:    round.max_score,
        arrows_data: mode !== 'total' ? arrowsData : undefined,
        plot_data: mode === 'plot' && plotData.length
          ? { face: (round as { target_face?: string | null }).target_face ?? 'wa-122', arrows: plotData }
          : undefined,
        notes:       values.notes,
        sync_source: isOffline ? 'offline' : 'manual',
        bow_category: deriveBowCategory(round),
        competition_year: snap?.competition_year ?? null,
        competition_age:  snap?.competition_age ?? null,
        age_group:        snap?.age_group ?? null,
      }

      if (isOffline) {
        // Queue for later sync
        await enqueue('score_submission', payload)
        return 'queued'
      }

      let proofUrl: string | undefined
      if (proofFile) {
        // Upload photo first
        const fakeId = uid()
        proofUrl = await uploadProofPhoto(profile.id, fakeId, proofFile)
      }

      return submitScore({ ...payload, proof_url: proofUrl })
    },
    onSuccess: (result) => {
      if (result === 'queued') {
        toast.warn(t('scoreEntry.savedOffline'), t('scoreEntry.savedOfflineHint'))
      } else {
        toast.ok(t('scoreEntry.submitted'), t('scoreEntry.submittedHint'))
      }
      queryClient.invalidateQueries({ queryKey: ['my-scores'] })
      queryClient.invalidateQueries({ queryKey: ['archer-submissions'] })
      queryClient.invalidateQueries({ queryKey: ['score-drafts'] })
      // A submitted score supersedes its draft.
      if (activeDraftId) {
        deleteDraft(activeDraftId).catch(() => {})
        setActiveDraftId(undefined)
      }
      reset()
      setArrowsData([])
      setPerArrowTotal(0)
      setProofFile(null)
      onClose()
    },
    onError: (err: Error) => {
      toast.err(t('scoreEntry.submitFailed'), err.message)
    },
  })

  // ── Drafts: save the form fields locally; resume via draftId prop ──────────
  const [activeDraftId, setActiveDraftId] = useState<string | undefined>(draftId)
  const [savingDraft, setSavingDraft] = useState(false)

  // Load the draft when opened with one; a fresh open starts a new draft.
  useEffect(() => {
    if (!open) return
    if (!draftId) {
      setActiveDraftId(undefined)
      return
    }
    setActiveDraftId(draftId)
    loadDraft(draftId).then((d) => {
      if (!d) return
      const v = d.data as Partial<FormValues>
      reset({
        round_id:     v.round_id ?? '',
        date:         v.date ?? today(),
        session_time: v.session_time ?? new Date().toTimeString().slice(0, 5),
        // Drafts restore as a plain total — per-arrow/plotted entries are
        // captured as their computed total when the draft was saved.
        mode:         'total',
        total_score:  v.total_score ?? 0,
        notes:        v.notes ?? '',
      })
    })
  }, [open, draftId, reset])

  async function handleSaveDraft() {
    if (!profile) return
    setSavingDraft(true)
    try {
      const v = getValues()
      const roundName = rounds.find((r) => r.id === v.round_id)?.name
      const label = `${roundName ?? 'Score'} · ${v.date}${v.total_score ? ` · ${v.total_score}` : ''}`
      const id = await saveDraft('score_submission', label, { ...v }, activeDraftId)
      setActiveDraftId(id)
      toast.ok(t('scoreEntry.draftSaved'), t('scoreEntry.draftSavedHint'))
      onClose()
    } catch (e: unknown) {
      toast.err(t('scoreEntry.draftFailed'), (e as Error).message)
    } finally {
      setSavingDraft(false)
    }
  }

  if (!open) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('scoreEntry.title')}
      width="min(720px,100%)"
    >
      <form
        onSubmit={handleSubmit((v) => submitMutation.mutateAsync(v))}
        className="space-y-4"
      >
        {isOffline && (
          <div className="p-3 rounded-[var(--r)] bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm flex items-center gap-2">
            <OfflineIcon />
            {t('scoreEntry.offlineBanner')}
          </div>
        )}

        {/* Session kind: Practice vs Tournament (filters the round list) */}
        <div>
          <label className="field-label">{t('scoreEntry.sessionKind')}</label>
          <div className="flex gap-2">
            {(['practice', 'tournament'] as const).map((k) => {
              const disabled = k === 'tournament' && !archersCanTournament
              return (
                <button
                  key={k}
                  type="button"
                  disabled={disabled}
                  title={disabled ? t('scoreEntry.tournamentBlocked') : undefined}
                  onClick={() => { setRoundType(k); setValue('round_id', '') }}
                  className={[
                    'flex-1 py-2 rounded-[var(--r)] text-sm font-semibold border transition-all',
                    disabled ? 'opacity-50 cursor-not-allowed bg-surface border-line text-text-faint'
                    : roundType === k
                      ? 'bg-primary text-on-primary border-primary'
                      : 'bg-surface border-line text-text-dim hover:border-line-strong',
                  ].join(' ')}
                >
                  {k === 'practice' ? `🎯 ${t('roundCategories.practice')}` : `🏆 ${t('roundCategories.tournament')}`}
                </button>
              )
            })}
          </div>
        </div>

        {/* Round */}
        <div>
          <label className="field-label">{t('common.round')}</label>
          <Select {...register('round_id')} error={errors.round_id?.message}>
            <option value="">
              {roundType === 'tournament' ? t('scoreEntry.selectTournamentRound') : t('scoreEntry.selectPracticeRound')}
            </option>
            {filteredRounds.map((r) => {
              const bows = (r.bow_categories ?? []).map((b) => t(`bowCategories.${b}`)).join(' / ')
              return (
                <option key={r.id} value={r.id}>
                  {r.name}{bows ? ` · ${bows}` : ''} (max {r.max_score})
                </option>
              )
            })}
          </Select>
          {filteredRounds.length === 0 && (
            <p className="text-xs text-text-faint mt-1">
              {myDisciplines.length ? t('scoreEntry.noRoundsForDiscipline') : t('scoreEntry.noRoundsOfType')}
            </p>
          )}
          {isTournament && (
            <div className={[
              'mt-2 flex items-start gap-2 p-2.5 rounded-[var(--r)] text-xs leading-relaxed',
              tournamentBlocked ? 'bg-danger-soft text-danger' : 'bg-yellow-50 border border-yellow-200 text-yellow-800',
            ].join(' ')}>
              <span className="font-bold">🏆</span>
              <span>
                {tournamentBlocked
                  ? t('scoreEntry.tournamentBlocked')
                  : proofRequired ? t('scoreEntry.tournamentProofHint') : t('scoreEntry.tournamentHint')}
              </span>
            </div>
          )}
        </div>

        {/* Date & session time */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('common.date')}
            type="date"
            {...register('date')}
            error={errors.date?.message}
          />
          <Input
            label={t('scoreEntry.sessionTime')}
            type="time"
            {...register('session_time')}
            error={errors.session_time?.message}
          />
        </div>

        {/* Entry mode */}
        <div>
          <label className="field-label">{t('scoreEntry.entryMode')}</label>
          <Controller
            control={control}
            name="mode"
            render={({ field }) => (
              <div className="flex gap-2">
                {(['total', 'per_arrow', 'plot'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => field.onChange(m)}
                    className={[
                      'flex-1 py-2 rounded-[var(--r)] text-sm font-semibold border transition-all',
                      field.value === m
                        ? 'bg-primary text-on-primary border-primary'
                        : 'bg-surface border-line text-text-dim hover:border-line-strong',
                    ].join(' ')}
                  >
                    {m === 'total' ? t('scoreEntry.modeTotal') : m === 'per_arrow' ? t('scoreEntry.modePerArrow') : t('scoreEntry.modePlot')}
                  </button>
                ))}
              </div>
            )}
          />
        </div>

        {/* Score input */}
        {mode === 'total' ? (
          <Input
            label={t('scoreEntry.modeTotal')}
            type="number"
            min={0}
            max={selectedRound?.max_score ?? 9999}
            {...register('total_score')}
            error={errors.total_score?.message}
            hint={selectedRound ? `${t('scoreEntry.max')}: ${selectedRound.max_score}` : undefined}
          />
        ) : (
          selectedRound ? (
            <div>
              <label className="field-label">{mode === 'plot' ? t('scoreEntry.plotLabel') : t('scoreEntry.enterArrows')}</label>
              {mode === 'plot' ? (
                <ArrowPlotter
                  totalArrows={selectedRound.total_arrows}
                  face={getFace((selectedRound as { target_face?: string | null }).target_face)}
                  arrowsPerEnd={
                    (selectedRound as { arrows_per_end?: number | null }).arrows_per_end
                    // Rounds created before the Round Manager have no end format —
                    // fall back to the archery convention: 6-arrow ends, or 3 for
                    // rounds whose total only divides by 3 (typical indoor).
                    ?? (selectedRound.total_arrows % 6 === 0 ? 6
                      : selectedRound.total_arrows % 3 === 0 ? 3
                      : undefined)
                  }
                  onChange={(arrows, total) => {
                    setArrowsData(arrows)
                    setPerArrowTotal(total)
                  }}
                  onPlotData={setPlotData}
                />
              ) : (
                <ArrowGrid
                  totalArrows={selectedRound.total_arrows}
                  endSize={(selectedRound as { arrows_per_end?: number | null }).arrows_per_end ?? undefined}
                  onChange={(arrows, total) => {
                    setArrowsData(arrows)
                    setPerArrowTotal(total)
                  }}
                />
              )}
              <div className="mt-3 p-3 rounded-[var(--r)] bg-primary-soft text-center">
                <span className="font-display font-bold text-2xl text-primary">
                  {perArrowTotal}
                </span>
                <span className="text-text-dim text-sm"> / {selectedRound.max_score}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-dim">{t('scoreEntry.selectRoundFirst')}</p>
          )
        )}

        {/* Proof photo */}
        <div>
          <label className="field-label">
            {t('scoreEntry.proofPhoto')}
            {proofRequired && <span className="text-danger ml-1">* {t('scoreEntry.required')}</span>}
          </label>
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="block w-full text-sm text-text-dim file:mr-3 file:py-2 file:px-3 file:rounded-[var(--r)] file:border-0 file:bg-primary-soft file:text-primary file:font-semibold file:text-sm cursor-pointer"
              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {proofFile && (
            <p className="text-xs text-ok mt-1">✓ {proofFile.name}</p>
          )}
        </div>

        {/* Notes */}
        <Input
          label={t('scoreEntry.notesOptional')}
          {...register('notes')}
          placeholder={t('scoreEntry.notesPlaceholder')}
        />

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            loading={savingDraft}
            onClick={handleSaveDraft}
          >
            {t('scoreEntry.saveDraft')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="flex-1"
            disabled={tournamentBlocked}
            loading={isSubmitting || submitMutation.isPending}
          >
            {isOffline ? t('scoreEntry.saveOffline') : t('scoreEntry.submitScore')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function OfflineIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
      <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
      <line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
  )
}
