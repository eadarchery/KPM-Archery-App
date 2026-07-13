import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { logTrainingSession } from '@/services/training'
import { triggerAchievementCheck } from '@/services/achievements'
import { enqueue } from '@/offline/syncQueue'
import { today } from '@/utils/dates'

const schema = z.object({
  date:         z.string().min(1, 'Enter a date'),
  arrows_shot:  z.coerce.number().int().min(1, 'At least 1 arrow').max(10000),
  session_type: z.string().optional(),
  notes:        z.string().optional(),
})

type FormValues = z.infer<typeof schema>

const SESSION_TYPES = [
  { value: '',        labelKey: 'trainingLog.selectType' },
  { value: 'indoor',  labelKey: 'trainingLog.indoor' },
  { value: 'outdoor', labelKey: 'trainingLog.outdoor' },
  { value: 'field',   labelKey: 'trainingLog.field' },
  { value: '3d',      labelKey: 'trainingLog.threeD' },
]

interface TrainingLogFormProps {
  open:    boolean
  onClose: () => void
}

export function TrainingLogForm({ open, onClose }: TrainingLogFormProps) {
  const { profile } = useAuth()
  const { t }       = useLanguage()
  const toast       = useToast()
  const queryClient = useQueryClient()
  const isOffline   = !navigator.onLine

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { date: today(), arrows_shot: 36 },
  })

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!profile) throw new Error('Not logged in')
      const payload = {
        archer_id:    profile.id,
        date:         values.date,
        arrows_shot:  values.arrows_shot,
        session_type: values.session_type || undefined,
        notes:        values.notes || undefined,
        sync_source:  isOffline ? 'offline' : 'manual',
      }
      if (isOffline) {
        await enqueue('training_log', payload)
        return 'queued'
      }
      return logTrainingSession(payload)
    },
    onSuccess: (result) => {
      if (result === 'queued') {
        toast.warn(t('scoreEntry.savedOffline'), t('scoreEntry.savedOfflineHint'))
      } else {
        toast.ok(t('trainingLog.logged'), t('trainingLog.loggedHint', { count: (result as any).arrows_shot }))
      }
      queryClient.invalidateQueries({ queryKey: ['my-training'] })
      // Re-check practice (total-arrows) achievements right away — otherwise
      // they would only be re-evaluated on the next score approval.
      if (profile?.id) {
        triggerAchievementCheck(profile.id).then(() => {
          queryClient.invalidateQueries({ queryKey: ['user-achievements'] })
        })
      }
      reset({ date: today(), arrows_shot: 36 })
      onClose()
    },
    onError: (err: Error) => {
      toast.err(t('trainingLog.logFailed'), err.message)
    },
  })

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title={t('trainingLog.title')}>
      <form
        onSubmit={handleSubmit((v) => mutation.mutateAsync(v))}
        className="space-y-4"
      >
        {isOffline && (
          <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-[var(--r)] px-3 py-2">
            {t('trainingLog.offlineBanner')}
          </p>
        )}

        <Input
          label={t('common.date')}
          type="date"
          {...register('date')}
          error={errors.date?.message}
        />

        <Input
          label={t('trainingLog.arrowsShot')}
          type="number"
          min={1}
          max={10000}
          {...register('arrows_shot')}
          error={errors.arrows_shot?.message}
        />

        <div>
          <label className="field-label">{t('trainingLog.sessionType')}</label>
          <Select {...register('session_type')}>
            {SESSION_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
            ))}
          </Select>
        </div>

        <Input
          label={t('scoreEntry.notesOptional')}
          {...register('notes')}
          placeholder={t('trainingLog.notesPlaceholder')}
        />

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="flex-1"
            loading={isSubmitting || mutation.isPending}
          >
            {t('trainingLog.logSession')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
