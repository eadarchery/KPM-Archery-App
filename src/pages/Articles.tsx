import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Badge, EmptyState } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { formatDate } from '@/utils/dates'
import { getPublishedArticlesForRole } from '@/services/articles'
import { canManageArticles, isSuperAdmin } from '@/lib/permissions'
import { useRuleValue } from '@/hooks/useSystemRules'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'
import type { Article } from '@/types'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

// Canonical stored category values (DB stores the English label). Display goes
// through t('articleCategories.…') — unknown/custom categories render as-is.
const CATEGORIES = [
  'Announcement', 'News', 'Guide', 'Achievement', 'Event',
  'Training', 'Nutrition', 'Mental Performance', 'Equipment', 'Other',
]

type SortKey = 'newest' | 'oldest' | 'featured'

// ─── FEATURED HERO ────────────────────────────────────────────────────────────

function FeaturedHero({
  article,
  onClick,
}: {
  article: Article
  onClick: () => void
}) {
  const { t } = useLanguage()
  const catLabel = (c: string) => (CATEGORIES.includes(c) ? t(`articleCategories.${c}`) : c)
  return (
    <div
      className="relative rounded-[var(--r)] overflow-hidden mb-6 cursor-pointer group"
      onClick={onClick}
    >
      {article.cover_url ? (
        <img
          src={article.cover_url}
          alt={article.title}
          className="w-full h-48 sm:h-64 object-cover group-hover:scale-[1.02] transition-transform duration-300"
        />
      ) : (
        <div
          className="w-full h-48 sm:h-64 flex items-center justify-center text-5xl"
          style={{ background: 'var(--primary-soft)' }}
        >
          📰
        </div>
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />

      {/* Content overlay */}
      <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Badge variant="primary" className="text-[10px]">{t('articles.featured')}</Badge>
          {article.category && (
            <span className="text-[10px] font-semibold text-white/80 bg-white/15 px-2 py-0.5 rounded-full">
              {catLabel(article.category)}
            </span>
          )}
        </div>
        <h2 className="text-white font-display font-semibold text-lg sm:text-2xl leading-tight mb-1 group-hover:underline underline-offset-2">
          {article.title}
        </h2>
        {article.summary && (
          <p className="text-white/75 text-sm line-clamp-2">{article.summary}</p>
        )}
        <div className="text-white/55 text-xs mt-2 flex items-center gap-2">
          {article.published_at && <span>{formatDate(article.published_at)}</span>}
          {(article.author_name || article.author?.name) && (
            <>
              <span className="opacity-60">·</span>
              <span>{article.author_name || article.author?.name}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ARTICLE CARD ─────────────────────────────────────────────────────────────

function ArticleCard({
  article,
  isAdmin,
  onClick,
}: {
  article: Article
  isAdmin: boolean
  onClick: () => void
}) {
  const { t } = useLanguage()
  const catLabel = (c: string) => (CATEGORIES.includes(c) ? t(`articleCategories.${c}`) : c)
  return (
    <div
      className="flex flex-col bg-surface border border-line rounded-[var(--r)] overflow-hidden cursor-pointer hover:shadow-card transition-shadow group"
      onClick={onClick}
    >
      {/* Cover thumbnail */}
      <div className="w-full h-40 bg-section flex-shrink-0 overflow-hidden">
        {article.cover_url ? (
          <img
            src={article.cover_url}
            alt={article.title}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl text-text-faint">
            📄
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col gap-2 flex-1">
        {/* Badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {article.is_featured && (
            <Badge variant="primary" className="text-[9px]">{t('articles.featured')}</Badge>
          )}
          {article.category && (
            <Badge variant="neutral" className="text-[9px]">{catLabel(article.category)}</Badge>
          )}
          {isAdmin && article.audience !== 'all' && (
            <Badge variant="neutral" className="text-[9px]">{t('articles.audienceOnly', { audience: article.audience })}</Badge>
          )}
        </div>

        {/* Title */}
        <h3 className="font-display font-semibold text-text text-sm leading-snug group-hover:text-primary transition-colors line-clamp-2">
          {article.title}
        </h3>

        {/* Summary */}
        {article.summary && (
          <p className="text-xs text-text-dim leading-relaxed line-clamp-2 flex-1">
            {article.summary}
          </p>
        )}

        {/* Tags */}
        {(article.tags ?? []).length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {(article.tags ?? []).slice(0, 3).map((tag) => (
              <span key={tag} className="text-[10px] text-text-faint">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 mt-auto border-t border-line">
          <span className="text-[11px] text-text-faint">
            {article.published_at ? formatDate(article.published_at) : ''}
          </span>
          {(article.author_name || article.author?.name) && (
            <span className="text-[11px] text-text-faint truncate max-w-[100px]">
              {article.author_name || article.author?.name}
            </span>
          )}
        </div>

        {/* Read button */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick() }}
          className="mt-1 w-full py-1.5 text-xs font-semibold rounded-[var(--r-sm)] border border-line text-text-dim hover:border-primary hover:text-primary transition-colors"
        >
          {t('articles.read')}
        </button>
      </div>
    </div>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function ArticlesPage() {
  const { profile }  = useAuth()
  const { t }        = useLanguage()
  const navigate     = useNavigate()
  const role         = profile?.role ?? 'archer'
  const isAdmin      = canManageArticles(role)

  const [search,         setSearch]         = useState('')
  const [filterCat,      setFilterCat]      = useState('')
  const [filterFeatured, setFilterFeatured] = useState(false)
  const [sort,           setSort]           = useState<SortKey>('newest')

  const { data: articles = [], isLoading, error } = useQuery<Article[]>({
    queryKey: ['articles-published', role],
    queryFn:  () => getPublishedArticlesForRole(role),
    enabled:  !!role,
  })

  // Module feature flag — safe fallback true so the page works if unreadable.
  const moduleEnabled = useRuleValue<boolean>('module_articles_enabled', true)

  const filtered = useMemo(() => {
    let list = [...articles]

    if (filterFeatured) list = list.filter((a) => a.is_featured)
    if (filterCat)      list = list.filter((a) => a.category === filterCat)

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          (a.summary ?? '').toLowerCase().includes(q) ||
          (a.category ?? '').toLowerCase().includes(q) ||
          (a.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      )
    }

    if (sort === 'oldest') {
      list = [...list].sort((a, b) =>
        (a.published_at ?? '') < (b.published_at ?? '') ? -1 : 1,
      )
    } else if (sort === 'featured') {
      list = [...list].sort(
        (a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0),
      )
    }
    // 'newest': already sorted desc from server

    return list
  }, [articles, filterCat, filterFeatured, search, sort])

  // Categories that actually have published articles (pill filter options),
  // in the canonical CATEGORIES order, unknown ones appended.
  const availableCategories = useMemo(() => {
    const present = new Set(articles.map((a) => a.category).filter(Boolean) as string[])
    return [
      ...CATEGORIES.filter((c) => present.has(c)),
      ...[...present].filter((c) => !CATEGORIES.includes(c)),
    ]
  }, [articles])

  // Group the filtered list by category for the divided sections view.
  const grouped = useMemo(() => {
    const map = new Map<string, Article[]>()
    for (const a of filtered) {
      const key = a.category || 'Other'
      const arr = map.get(key) ?? []
      arr.push(a)
      map.set(key, arr)
    }
    const order = [...CATEGORIES.filter((c) => map.has(c)), ...[...map.keys()].filter((c) => !CATEGORIES.includes(c))]
    return order.map((c) => ({ category: c, items: map.get(c)! }))
  }, [filtered])

  // Featured hero — only show when no filters active
  const showHero =
    !search && !filterCat && !filterFeatured && sort === 'newest'
  const heroArticle = showHero
    ? (articles.find((a) => a.is_featured) ?? null)
    : null

  function goToArticle(slug: string) {
    navigate(`/articles/${slug}`)
  }

  // Module turned off → unavailable state, unless Super Admin (who can preview).
  if (!moduleEnabled && !isSuperAdmin(role)) {
    return (
      <FeatureUnavailable
        title={t('articles.unavailable')}
        message={t('articles.unavailableHint')}
      />
    )
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('articles.title')}
        description={t('articles.pageDescription')}
      />

      {/* Featured hero */}
      {heroArticle && (
        <FeaturedHero
          article={heroArticle}
          onClick={() => goToArticle(heroArticle.slug)}
        />
      )}

      {/* Search + filters */}
      <div className="bg-surface border border-line rounded-[var(--r)] p-3 mb-6 space-y-3">
        {/* Search + sort + featured */}
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('articles.searchPlaceholder')}
              className="field w-full text-sm pr-9"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
            </span>
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="field text-sm py-2 w-auto"
          >
            <option value="newest">{t('articles.newestFirst')}</option>
            <option value="oldest">{t('articles.oldestFirst')}</option>
            <option value="featured">{t('articles.featuredFirst')}</option>
          </select>
          <button
            type="button"
            onClick={() => setFilterFeatured((f) => !f)}
            className={cn(
              'px-3.5 py-2 rounded-full text-xs font-semibold border transition-colors',
              filterFeatured
                ? 'bg-primary text-primary-on border-primary'
                : 'bg-section text-text-dim border-line hover:border-primary hover:text-text',
            )}
          >
            ★ {t('articles.featured')}
          </button>
        </div>

        {/* Category pills — only categories that actually have articles */}
        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setFilterCat('')}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
              !filterCat
                ? 'bg-primary text-primary-on border-primary'
                : 'bg-section text-text-dim border-line hover:border-primary hover:text-text',
            )}
          >
            {t('common.all')}
          </button>
          {availableCategories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilterCat(filterCat === c ? '' : c)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                filterCat === c
                  ? 'bg-primary text-primary-on border-primary'
                  : 'bg-section text-text-dim border-line hover:border-primary hover:text-text',
              )}
            >
              {CATEGORIES.includes(c) ? t(`articleCategories.${c}`) : c}
            </button>
          ))}
        </div>
      </div>

      {/* Content states */}
      {isLoading ? (
        <div className="py-20 text-center text-text-faint text-sm">
          {t('common.loading')}
        </div>
      ) : error ? (
        <SectionCard>
          <EmptyState
            title={t('articles.loadError')}
            description={t('articles.loadErrorHint')}
          />
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            title={t('articles.empty')}
            description={
              search || filterCat || filterFeatured
                ? t('common.noResultsFilters')
                : t('articles.emptyHint')
            }
          />
        </SectionCard>
      ) : (
        <div className="space-y-8 pb-6">
          {grouped.map(({ category, items }) => (
            <section key={category}>
              {/* Category heading with horizontal divider */}
              <div className="flex items-center gap-3 mb-4">
                <h2 className="font-display font-semibold text-sm uppercase tracking-[.08em] text-text-dim whitespace-nowrap">
                  {CATEGORIES.includes(category) ? t(`articleCategories.${category}`) : category}
                </h2>
                <span className="text-[11px] text-text-faint">{items.length}</span>
                <div className="h-px bg-line flex-1" />
              </div>

              {/* Article grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {items.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    isAdmin={isAdmin}
                    onClick={() => goToArticle(article.slug)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageWrapper>
  )
}
