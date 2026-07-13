import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper } from '@/components/layout/PageWrapper'
import { Button, Badge } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate } from '@/utils/dates'
import { getPublishedArticleBySlug } from '@/services/articles'
import { canManageArticles } from '@/lib/permissions'
import { useHasPermission } from '@/hooks/useRolePermissions'
import { ArticleBodyPreview } from '@/components/articles/BlockEditor'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'
import type { Article } from '@/types'

// ─── QUOTE STYLE COLOURS ──────────────────────────────────────────────────────

const QUOTE_CLS: Record<string, string> = {
  info:    'border-primary bg-primary-soft/20 text-primary',
  warning: 'border-warning bg-warning-soft/20 text-warning',
  success: 'border-success bg-success-soft/20 text-success',
  note:    'border-line-strong bg-section text-text-dim',
}

// ─── ARTICLE READER ───────────────────────────────────────────────────────────

function ArticleReader({ article }: { article: Article }) {
  const { t } = useLanguage()
  return (
    <article className="max-w-2xl mx-auto pb-20">
      {/* Cover image */}
      {article.cover_url && (
        <img
          src={article.cover_url}
          alt={article.title}
          className="w-full max-h-72 object-cover rounded-[var(--r)] mb-6"
        />
      )}

      {/* Meta badges */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {article.is_featured && <Badge variant="primary">{t('articles.featured')}</Badge>}
        {article.category && <Badge variant="neutral">{article.category}</Badge>}
      </div>

      {/* Title */}
      <h1 className="text-2xl sm:text-3xl font-display font-semibold text-text leading-tight mb-3">
        {article.title}
      </h1>

      {/* Summary */}
      {article.summary && (
        <p className="text-text-dim text-base leading-relaxed border-l-4 border-primary pl-4 mb-4 italic">
          {article.summary}
        </p>
      )}

      {/* Author + date */}
      <div className="flex items-center gap-2 text-sm text-text-faint mb-4 flex-wrap">
        {(article.author_name || article.author?.name) && <span>{article.author_name || article.author?.name}</span>}
        {(article.author_name || article.author?.name) && article.published_at && (
          <span className="opacity-40">·</span>
        )}
        {article.published_at && <span>{formatDate(article.published_at)}</span>}
      </div>

      {/* Tags */}
      {(article.tags ?? []).length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-6">
          {(article.tags ?? []).map((tag) => (
            <Badge key={tag} variant="neutral" className="text-xs">
              #{tag}
            </Badge>
          ))}
        </div>
      )}

      <hr className="border-line mb-8" />

      {/* Body blocks */}
      {Array.isArray(article.body_blocks) && article.body_blocks.length > 0 ? (
        <div className={cn('space-y-6 text-text leading-relaxed')}>
          <ArticleBodyPreview blocks={article.body_blocks} />
        </div>
      ) : (
        <p className="text-text-faint text-sm italic text-center py-10">
          {t('articleDetail.noContent')}
        </p>
      )}
    </article>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function ArticleDetailPage() {
  const { slug }   = useParams<{ slug: string }>()
  const navigate   = useNavigate()
  const { profile } = useAuth()
  const { t } = useLanguage()

  const role    = profile?.role ?? 'archer'
  // DB role-permission layer, with the static helper as a safe fallback.
  const isAdmin = useHasPermission(role, 'edit_article', canManageArticles(role))

  const { data: article, isLoading, error } = useQuery<Article | null>({
    queryKey: ['article', slug, role],
    queryFn:  () => getPublishedArticleBySlug(slug!, role),
    enabled:  !!slug && !!role,
  })

  return (
    <PageWrapper>
      {/* Back + Edit bar */}
      <div className="flex items-center gap-2 mb-6">
        <button
          type="button"
          onClick={() => navigate('/articles')}
          className="inline-flex items-center gap-1.5 text-sm text-text-dim hover:text-text transition-colors"
        >
          ← {t('articleDetail.backToArticles')}
        </button>
        <div className="flex-1" />
        {isAdmin && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/admin2/articles')}
          >
            {t('articleDetail.editInManager')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-text-faint text-sm">{t('common.loading')}</div>
      ) : error || !article ? (
        <div className="py-20 text-center space-y-4">
          <p className="text-text-dim text-sm">
            {t('articleDetail.notFound')}
          </p>
          <Button variant="ghost" onClick={() => navigate('/articles')}>
            {t('articleDetail.backToArticles')}
          </Button>
        </div>
      ) : (
        <ArticleReader article={article} />
      )}
    </PageWrapper>
  )
}
