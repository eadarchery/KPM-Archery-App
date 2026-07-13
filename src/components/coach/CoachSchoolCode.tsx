import { useQuery } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'

/**
 * Shows the coach their school's registration code so they can share it with
 * archers. An archer enters this code at sign-up to request joining the school
 * and then appears in the coach's approval queue.
 */
export function CoachSchoolCode() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const schoolId = profile?.school_id

  const { data } = useQuery({
    queryKey: ['coach-school-code', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schools')
        .select('name, reg_code')
        .eq('id', schoolId!)
        .single()
      if (error) throw error
      return data as { name: string; reg_code: string | null }
    },
    enabled: !!schoolId,
  })

  if (!schoolId || !data?.reg_code) return null

  return (
    <SectionCard className="mb-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[.06em] text-text-faint">
            {t('schoolCode.yourCode')}{data.name ? ` · ${data.name}` : ''}
          </div>
          <div className="font-mono text-xl font-bold text-text tracking-[.2em] mt-1">{data.reg_code}</div>
        </div>
        <p className="text-xs text-text-dim max-w-[300px]">
          {t('schoolCode.shareHint')}
        </p>
      </div>
    </SectionCard>
  )
}
