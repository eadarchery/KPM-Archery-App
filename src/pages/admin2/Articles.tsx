import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import {
  Button, Badge, StatCard, Modal, ConfirmDialog,
  Input, Textarea, Select, EmptyState, useToast,
} from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'
import { formatDate, timeAgo } from '@/utils/dates'
import { writeAuditLog } from '@/services/auditLog'
import {
  getAllArticlesAdmin, createArticle, updateArticle, deleteArticle,
} from '@/services/articles'
import {
  BlockEditor, ArticleBodyPreview, uploadArticleImage,
} from '@/components/articles/BlockEditor'
import type { Article, ArticleBlock, ArticleStatus } from '@/types'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'Announcement', 'News', 'Guide', 'Achievement', 'Event',
  'Training', 'Nutrition', 'Mental Performance', 'Equipment', 'Other',
]

const AUDIENCE_OPTION_KEYS = [
  { value: 'all',    labelKey: 'adminArticles.audAll' },
  { value: 'archer', labelKey: 'adminArticles.audArcher' },
  { value: 'coach',  labelKey: 'adminArticles.audCoach' },
  { value: 'admin1', labelKey: 'adminArticles.audAdmin1' },
  { value: 'admin2', labelKey: 'adminArticles.audAdmin2' },
]

type Translate = (key: string, vars?: Record<string, string | number>) => string

type TabKey = 'all' | ArticleStatus | 'featured'

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function toSlug(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
}

function statusBadgeVariant(status: ArticleStatus): 'success' | 'warning' | 'neutral' {
  if (status === 'published') return 'success'
  if (status === 'draft')     return 'warning'
  return 'neutral'
}

function audienceLabel(t: Translate, audience: string): string {
  const opt = AUDIENCE_OPTION_KEYS.find(o => o.value === audience)
  return opt ? t(opt.labelKey) : audience
}

// ─── ARTICLE CARD ─────────────────────────────────────────────────────────────

interface ArticleCardProps {
  article: Article
  onEdit:      () => void
  onPreview:   () => void
  onPublish:   () => void
  onArchive:   () => void
  onDuplicate: () => void
  onDelete:    () => void
  publishing:  boolean
  archiving:   boolean
}

function ArticleCard({
  article, onEdit, onPreview, onPublish, onArchive,
  onDuplicate, onDelete, publishing, archiving,
}: ArticleCardProps) {
  const { t } = useLanguage()
  return (
    <div className="flex gap-3 p-4 hover:bg-surface-soft transition-colors group">
      {/* Cover thumbnail */}
      <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-[var(--r-sm)] overflow-hidden bg-section border border-line">
        {article.cover_url ? (
          <img
            src={article.cover_url}
            alt={article.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-faint text-2xl">
            📄
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap mb-1">
          <span className="font-semibold text-text text-sm leading-snug">{article.title}</span>
          {article.is_featured && (
            <Badge variant="primary" className="text-[9px] shrink-0">{t('adminArticles.featured')}</Badge>
          )}
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          <Badge variant={statusBadgeVariant(article.status)} className="text-[9px]" dot>
            {t(`status.${article.status}`)}
          </Badge>
          <Badge variant="neutral" className="text-[9px]">
            {audienceLabel(t, article.audience)}
          </Badge>
          {article.category && (
            <Badge variant="neutral" className="text-[9px]">{t(`articleCategories.${article.category}`)}</Badge>
          )}
          {(article.tags ?? []).slice(0, 2).map(tag => (
            <Badge key={tag} variant="neutral" className="text-[9px]">#{tag}</Badge>
          ))}
        </div>

        {/* Excerpt */}
        {article.summary && (
          <p className="text-xs text-text-dim leading-relaxed line-clamp-1 mb-1">
            {article.summary}
          </p>
        )}

        {/* Meta */}
        <div className="text-[11px] text-text-faint flex gap-3 flex-wrap">
          {article.published_at
            ? <span>{t('adminArticles.publishedOn')} {formatDate(article.published_at)}</span>
            : <span>{t('statesPage.updatedOn')} {timeAgo(article.updated_at)}</span>
          }
          {(article.author_name || article.author?.name) && <span>{t('adminArticles.by')} {article.author_name || article.author?.name}</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 items-end flex-shrink-0">
        <Button size="sm" variant="ghost" onClick={onEdit}>{t('common.edit')}</Button>
        <Button size="sm" variant="ghost" onClick={onPreview}>{t('common.preview')}</Button>
        <div className="flex gap-1">
          {article.status === 'draft' && (
            <Button size="sm" variant="success" onClick={onPublish} loading={publishing}>
              {t('adminArticles.publish')}
            </Button>
          )}
          {article.status === 'published' && (
            <Button size="sm" variant="warning" onClick={onArchive} loading={archiving}>
              {t('common.archive')}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDuplicate} title={t('common.duplicate')}>⧉</Button>
          <Button size="sm" variant="danger" onClick={onDelete} title={t('common.delete')}>×</Button>
        </div>
      </div>
    </div>
  )
}

// ─── PREVIEW MODAL ────────────────────────────────────────────────────────────

function PreviewModal({
  article,
  blocks,
  open,
  onClose,
}: {
  article: Partial<Article>
  blocks: ArticleBlock[]
  open: boolean
  onClose: () => void
}) {
  const { t } = useLanguage()
  return (
    <Modal open={open} onClose={onClose} width="min(720px,100%)" title={t('adminArticles.previewTitle')}>
      <div className="space-y-4">
        {/* Cover */}
        {article.cover_url && (
          <img
            src={article.cover_url}
            alt={article.title ?? ''}
            className="w-full max-h-48 object-cover rounded-[var(--r)]"
          />
        )}

        {/* Meta */}
        <div className="flex flex-wrap gap-1.5">
          {article.status && (
            <Badge variant={statusBadgeVariant(article.status as ArticleStatus)}>
              {t(`status.${article.status}`)}
            </Badge>
          )}
          {article.category && <Badge variant="neutral">{t(`articleCategories.${article.category}`)}</Badge>}
          {article.audience && <Badge variant="neutral">{audienceLabel(t, article.audience)}</Badge>}
          {article.is_featured && <Badge variant="primary">{t('adminArticles.featured')}</Badge>}
        </div>

        {/* Title */}
        <h1 className="text-2xl font-display font-semibold text-text leading-tight">
          {article.title || <span className="text-text-faint italic">{t('adminArticles.noTitle')}</span>}
        </h1>

        {/* Excerpt */}
        {article.summary && (
          <p className="text-text-dim text-sm leading-relaxed border-l-2 border-primary pl-3">
            {article.summary}
          </p>
        )}

        {/* Tags */}
        {(article.tags ?? []).length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {(article.tags ?? []).map(tag => (
              <Badge key={tag} variant="neutral" className="text-xs">#{tag}</Badge>
            ))}
          </div>
        )}

        <hr className="border-line" />

        {/* Body blocks */}
        {blocks.length > 0 ? (
          <ArticleBodyPreview blocks={blocks} />
        ) : (
          <p className="text-text-faint text-sm italic text-center py-6">{t('adminArticles.noBlocks')}</p>
        )}
      </div>
    </Modal>
  )
}

// ─── FORM STATE ───────────────────────────────────────────────────────────────

interface FormState {
  title: string
  slug: string
  summary: string
  cover_url: string
  audiences: string[]
  category: string
  tags: string
  author_name: string
  is_featured: boolean
  blocks: ArticleBlock[]
}

function initForm(article?: Article): FormState {
  if (!article) {
    return {
      title: '', slug: '', summary: '', cover_url: '',
      audiences: ['all'], category: '', tags: '', author_name: '',
      is_featured: false, blocks: [],
    }
  }
  const legacy = article.audience ? [article.audience] : ['all']
  const multi = (article as { audiences?: string[] | null }).audiences
  return {
    title:       article.title,
    slug:        article.slug,
    summary:     article.summary ?? article.dek ?? '',
    cover_url:   article.cover_url ?? '',
    audiences:   multi && multi.length ? multi : legacy,
    category:    article.category ?? '',
    tags:        (article.tags ?? []).join(', '),
    author_name: (article as { author_name?: string | null }).author_name ?? '',
    is_featured: article.is_featured ?? false,
    blocks:      Array.isArray(article.body_blocks) ? article.body_blocks : [],
  }
}

// ─── EDITOR VIEW ──────────────────────────────────────────────────────────────

interface EditorViewProps {
  article?: Article
  profileId: string
  onBack:  () => void
  onSaved: (a: Article) => void
}

function EditorView({ article, profileId, onBack, onSaved }: EditorViewProps) {
  const { t } = useLanguage()
  const toast = useToast()
  const qc    = useQueryClient()
  const isNew = !article

  const [form, setForm] = useState<FormState>(() => initForm(article))
  const [slugManual, setSlugManual]   = useState(!isNew)
  const [coverUploading, setCoverUploading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [errors, setErrors]           = useState<Record<string, string>>({})

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(prev => {
      const next = { ...prev, [key]: val }
      if (key === 'title' && !slugManual) {
        next.slug = toSlug(String(val))
      }
      return next
    })
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!form.title.trim()) errs.title = t('adminArticles.errTitle')
    if (!form.slug.trim())  errs.slug  = t('adminAch.errSlug')
    if (!/^[a-z0-9-_]+$/.test(form.slug))
      errs.slug = t('adminArticles.errSlugFormat')
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const saveMut = useMutation({
    mutationFn: async (publishMode: 'draft' | 'publish') => {
      if (!validate()) throw new Error('Validation failed')
      const tags    = parseTags(form.tags)
      const payload = {
        title:       form.title,
        slug:        form.slug,
        summary:     form.summary || undefined,
        cover_url:   form.cover_url || undefined,
        // Multi-audience array + legacy single column kept in sync for
        // display / pre-053 fallback ('all' wins, else first tick).
        audiences:   form.audiences.length ? form.audiences : ['all'],
        audience:    form.audiences.includes('all') || form.audiences.length === 0 ? 'all' : form.audiences[0],
        category:    form.category || undefined,
        tags,
        author_name: form.author_name.trim() || null,
        is_featured: form.is_featured,
        body_blocks: form.blocks,
      }

      if (isNew) {
        return createArticle({
          ...payload,
          author_id: profileId,
          status:    publishMode === 'publish' ? 'published' : 'draft',
          ...(publishMode === 'publish' ? { published_at: new Date().toISOString() } : {}),
        } as Parameters<typeof createArticle>[0])
      } else {
        return updateArticle(article!.id, {
          ...payload,
          updated_by: profileId,
          ...(publishMode === 'publish' && article!.status !== 'published'
            ? { status: 'published', published_at: new Date().toISOString() }
            : {}),
        })
      }
    },
    onSuccess: async (saved, publishMode) => {
      await writeAuditLog(
        profileId,
        isNew ? 'article.created' : 'article.updated',
        'article',
        saved.id,
        { title: saved.title, status: saved.status },
      )
      if (publishMode === 'publish') {
        await writeAuditLog(profileId, 'article.published', 'article', saved.id)
      }
      await qc.invalidateQueries({ queryKey: ['articles-admin'] })
      toast.ok(isNew ? t('adminArticles.created') : t('adminArticles.saved'))
      onSaved(saved)
    },
    onError: (err: Error) => {
      if (err.message !== 'Validation failed') toast.err(err.message)
    },
  })

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverUploading(true)
    try {
      const url = await uploadArticleImage(file, form.slug || 'draft', 'cover-')
      set('cover_url', url)
      toast.ok(t('adminArticles.coverUploaded'))
    } catch (err: unknown) {
      toast.err(err instanceof Error ? err.message : t('common.actionFailed'))
    } finally {
      setCoverUploading(false)
      e.target.value = ''
    }
  }

  const previewArticle: Partial<Article> = {
    title:       form.title,
    summary:     form.summary,
    cover_url:   form.cover_url || undefined,
    audience:    form.audiences.includes('all') || form.audiences.length === 0 ? 'all' : form.audiences[0],
    category:    form.category || undefined,
    tags:        parseTags(form.tags),
    is_featured: form.is_featured,
    status:      article?.status ?? 'draft',
  }

  return (
    <>
      {/* ── Sticky top bar ── */}
      <div className="sticky top-0 z-20 bg-surface border-b border-line flex items-center gap-2 px-4 py-3 mb-6 -mx-4 flex-wrap">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-text-dim hover:text-text transition-colors"
        >
          ← {t('adminArticles.backToArticles')}
        </button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(true)}>
          {t('common.preview')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => saveMut.mutate('draft')}
          loading={saveMut.isPending}
        >
          {t('adminArticles.saveDraft')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => saveMut.mutate('publish')}
          loading={saveMut.isPending}
        >
          {article?.status === 'published' ? t('adminArticles.saveAndPublish') : t('adminArticles.publish')}
        </Button>
      </div>

      <div className="space-y-6">

        {/* ── Title ── */}
        <input
          type="text"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder={t('adminArticles.titlePlaceholder')}
          className={cn(
            'w-full text-[26px] sm:text-[32px] font-display font-semibold tracking-tight bg-transparent border-none outline-none text-text placeholder:text-text-faint leading-tight',
            errors.title && 'text-danger',
          )}
        />
        {errors.title && <p className="text-xs text-danger -mt-4">{errors.title}</p>}

        {/* ── Metadata card ── */}
        <SectionCard title={t('adminArticles.settings')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Slug */}
            <div className="col-span-full">
              <Input
                label={t('adminArticles.slugLabel')}
                value={form.slug}
                onChange={(e) => {
                  setSlugManual(true)
                  set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-'))
                }}
                error={errors.slug}
                hint={`/articles/${form.slug || 'your-slug-here'}`}
                placeholder="article-slug"
              />
            </div>

            {/* Summary */}
            <div className="col-span-full">
              <Textarea
                label={t('adminArticles.summaryLabel')}
                value={form.summary}
                onChange={(e) => set('summary', e.target.value)}
                placeholder={t('adminArticles.summaryPlaceholder')}
                minRows={2}
              />
            </div>

            {/* Category */}
            <Select
              label={t('adminArticles.category')}
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              options={[
                { value: '', label: t('adminArticles.none') },
                ...CATEGORIES.map(c => ({ value: c, label: t(`articleCategories.${c}`) })),
              ]}
            />

            {/* Visibility — checkboxes, multiple roles allowed */}
            <div className="col-span-full">
              <p className="text-[12px] font-semibold text-text-dim mb-1.5">{t('adminArticles.visibility')}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {AUDIENCE_OPTION_KEYS.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-primary"
                      checked={form.audiences.includes(o.value)}
                      onChange={() => {
                        const next = form.audiences.includes(o.value)
                          ? form.audiences.filter(a => a !== o.value)
                          : [...form.audiences, o.value]
                        set('audiences', next)
                      }}
                    />
                    <span className="text-sm text-text">{t(o.labelKey)}</span>
                  </label>
                ))}
              </div>
              {form.audiences.length === 0 && (
                <p className="text-[11px] text-warning mt-1">{t('adminArticles.nothingTicked')}</p>
              )}
            </div>

            {/* Tags */}
            <div className="col-span-full">
              <Input
                label={t('adminArticles.tagsLabel')}
                value={form.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder={t('adminArticles.tagsPlaceholder')}
              />
            </div>

            {/* Author name (byline) — overrides the automatic creator name */}
            <div className="col-span-full">
              <Input
                label={t('adminArticles.authorNameLabel')}
                value={form.author_name}
                onChange={(e) => set('author_name', e.target.value)}
                placeholder={t('adminArticles.authorNamePlaceholder')}
                hint={t('adminArticles.authorNameHint')}
              />
            </div>

            {/* Featured */}
            <div className="col-span-full flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={form.is_featured}
                onClick={() => set('is_featured', !form.is_featured)}
                className={cn(
                  'relative inline-flex h-6 w-11 items-center rounded-full transition-colors border',
                  form.is_featured
                    ? 'bg-primary border-primary'
                    : 'bg-section border-line',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                    form.is_featured ? 'translate-x-6' : 'translate-x-1',
                  )}
                />
              </button>
              <label className="text-sm text-text cursor-pointer" onClick={() => set('is_featured', !form.is_featured)}>
                {t('adminArticles.featureThis')}
              </label>
            </div>

            {/* Cover image */}
            <div className="col-span-full">
              <p className="text-[12px] font-semibold text-text-dim mb-0.5">{t('adminArticles.coverImage')}</p>
              <p className="text-[11px] text-text-faint mb-1.5">
                {t('adminArticles.coverHint')}
              </p>
              {form.cover_url ? (
                <div className="relative group inline-block">
                  <img
                    src={form.cover_url}
                    alt={t('adminArticles.coverImage')}
                    className="max-h-36 rounded-[var(--r)] border border-line object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => set('cover_url', '')}
                    className="absolute top-2 right-2 bg-danger text-white text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    {t('common.remove')}
                  </button>
                </div>
              ) : (
                <label
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 border border-dashed border-line rounded-[var(--r)] cursor-pointer',
                    'hover:border-primary hover:bg-primary-soft/10 transition-colors',
                    coverUploading && 'opacity-50 pointer-events-none',
                  )}
                >
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/webp"
                    onChange={handleCoverUpload}
                    className="sr-only"
                  />
                  <span className="text-text-faint text-sm">
                    {coverUploading ? t('common.uploading') : t('adminArticles.uploadCover')}
                  </span>
                  <span className="text-text-faint text-xs ml-auto">PNG, JPG, WebP</span>
                </label>
              )}
            </div>
          </div>
        </SectionCard>

        {/* ── Block editor ── */}
        <SectionCard title={t('adminArticles.content')}>
          <BlockEditor
            blocks={form.blocks}
            onChange={(blocks) => set('blocks', blocks)}
            articleSlug={form.slug || 'draft'}
            onError={(msg) => toast.err(msg)}
          />
        </SectionCard>

        {/* ── Bottom action bar ── */}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={onBack}>{t('common.cancel')}</Button>
          <Button
            variant="ghost"
            onClick={() => saveMut.mutate('draft')}
            loading={saveMut.isPending}
          >
            {t('adminArticles.saveDraft')}
          </Button>
          <Button
            variant="primary"
            onClick={() => saveMut.mutate('publish')}
            loading={saveMut.isPending}
          >
            {article?.status === 'published' ? t('adminArticles.saveAndPublish') : t('adminArticles.publish')}
          </Button>
        </div>
      </div>

      {/* Preview modal */}
      <PreviewModal
        article={previewArticle}
        blocks={form.blocks}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />
    </>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function Admin2Articles() {
  const { profile }   = useAuth()
  const { t }         = useLanguage()
  const toast         = useToast()
  const qc            = useQueryClient()
  const profileId     = profile?.id ?? ''

  // View state
  const [view,       setView]       = useState<'list' | 'editor'>('list')
  const [editing,    setEditing]    = useState<Article | undefined>(undefined)
  const [delConfirm, setDelConfirm] = useState<Article | null>(null)
  const [previewArt, setPreviewArt] = useState<Article | null>(null)

  // List filters
  const [tab,         setTab]         = useState<TabKey>('all')
  const [search,      setSearch]      = useState('')
  const [filterCat,   setFilterCat]   = useState('')
  const [filterAud,   setFilterAud]   = useState('')

  // Data
  const { data: articles = [], isLoading } = useQuery<Article[]>({
    queryKey: ['articles-admin'],
    queryFn:  () => getAllArticlesAdmin(),
  })

  // Stat counts
  const counts = useMemo(() => ({
    total:     articles.length,
    published: articles.filter(a => a.status === 'published').length,
    draft:     articles.filter(a => a.status === 'draft').length,
    archived:  articles.filter(a => a.status === 'archived').length,
    featured:  articles.filter(a => a.is_featured).length,
  }), [articles])

  // Filtered list
  const filtered = useMemo(() => {
    let list = [...articles]
    if (tab === 'featured') list = list.filter(a => a.is_featured)
    else if (tab !== 'all') list = list.filter(a => a.status === tab)
    if (filterCat) list = list.filter(a => a.category === filterCat)
    if (filterAud) list = list.filter(a => a.audience === filterAud)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        a.title.toLowerCase().includes(q) ||
        (a.summary ?? '').toLowerCase().includes(q) ||
        (a.tags ?? []).some(t => t.toLowerCase().includes(q)),
      )
    }
    return list
  }, [articles, tab, filterCat, filterAud, search])

  // ── Publish mutation ──
  const publishMut = useMutation({
    mutationFn: (id: string) =>
      updateArticle(id, {
        status: 'published',
        published_at: new Date().toISOString(),
        updated_by: profileId,
      }),
    onSuccess: async (saved) => {
      await writeAuditLog(profileId, 'article.published', 'article', saved.id, { title: saved.title })
      await qc.invalidateQueries({ queryKey: ['articles-admin'] })
      toast.ok(t('adminArticles.publishedToast'))
    },
    onError: (err: Error) => toast.err(err.message),
  })

  // ── Archive mutation ──
  const archiveMut = useMutation({
    mutationFn: (id: string) =>
      updateArticle(id, {
        status: 'archived',
        archived_at: new Date().toISOString(),
        updated_by: profileId,
      }),
    onSuccess: async (saved) => {
      await writeAuditLog(profileId, 'article.archived', 'article', saved.id, { title: saved.title })
      await qc.invalidateQueries({ queryKey: ['articles-admin'] })
      toast.ok(t('adminArticles.archivedToast'))
    },
    onError: (err: Error) => toast.err(err.message),
  })

  // ── Duplicate mutation ──
  const dupMut = useMutation({
    mutationFn: async (a: Article) => {
      const baseSlug = toSlug(`${a.title}-copy`)
      const slug = `${baseSlug}-${Date.now().toString(36)}`
      return createArticle({
        title:       `${a.title} (Copy)`,
        slug,
        summary:     a.summary ?? a.dek,
        cover_url:   a.cover_url,
        body_blocks: a.body_blocks,
        audience:    a.audience,
        category:    a.category,
        tags:        a.tags,
        is_featured: false,
        author_id:   profileId,
        status:      'draft',
      })
    },
    onSuccess: async (saved) => {
      await writeAuditLog(profileId, 'article.duplicated', 'article', saved.id, { title: saved.title })
      await qc.invalidateQueries({ queryKey: ['articles-admin'] })
      toast.ok(t('adminArticles.duplicatedToast'))
    },
    onError: (err: Error) => toast.err(err.message),
  })

  // ── Delete mutation ──
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteArticle(id),
    onSuccess: async (_, id) => {
      const title = delConfirm?.title ?? ''
      await writeAuditLog(profileId, 'article.deleted', 'article', id, { title })
      await qc.invalidateQueries({ queryKey: ['articles-admin'] })
      setDelConfirm(null)
      toast.ok(t('adminArticles.deletedToast'))
    },
    onError: (err: Error) => toast.err(err.message),
  })

  function openNew() {
    setEditing(undefined)
    setView('editor')
  }

  function openEdit(a: Article) {
    setEditing(a)
    setView('editor')
  }

  function handleSaved() {
    setView('list')
  }

  // ── EDITOR VIEW ──────────────────────────────────────────────
  if (view === 'editor') {
    return (
      <PageWrapper>
        <EditorView
          article={editing}
          profileId={profileId}
          onBack={() => setView('list')}
          onSaved={handleSaved}
        />
      </PageWrapper>
    )
  }

  // ── LIST VIEW ────────────────────────────────────────────────
  return (
    <PageWrapper>
      <PageHead
        title={t('adminArticles.title')}
        description={t('adminArticles.description')}
        action={
          <Button onClick={openNew} icon={<span>+</span>}>
            {t('adminArticles.newArticle')}
          </Button>
        }
      />

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {([
          { key: 'all',       label: t('common.total'),     value: counts.total },
          { key: 'published', label: t('status.published'),  value: counts.published },
          { key: 'draft',     label: t('adminArticles.drafts'),     value: counts.draft },
          { key: 'archived',  label: t('status.archived'),   value: counts.archived },
          { key: 'featured',  label: t('adminArticles.featured'),   value: counts.featured },
        ] as { key: TabKey; label: string; value: number }[]).map(({ key, label, value }) => (
          <StatCard
            key={key}
            label={label}
            value={value}
            clickable
            active={tab === key}
            onClick={() => setTab(key)}
          />
        ))}
      </div>

      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-1">
        {(['all', 'draft', 'published', 'archived', 'featured'] as TabKey[]).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors',
              tab === tabKey
                ? 'bg-primary text-primary-on'
                : 'bg-section text-text-dim hover:bg-surface-soft hover:text-text',
            )}
          >
            {tabKey === 'all' ? t('common.all')
              : tabKey === 'featured' ? t('adminArticles.featured')
              : t(`status.${tabKey}`)}
          </button>
        ))}
      </div>

      {/* ── Search + Filters ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('adminArticles.searchPlaceholder')}
          className="field flex-1 min-w-[160px] text-sm"
        />
        <select
          value={filterCat}
          onChange={(e) => setFilterCat(e.target.value)}
          className="field text-sm py-2"
        >
          <option value="">{t('common.allCategories')}</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{t(`articleCategories.${c}`)}</option>)}
        </select>
        <select
          value={filterAud}
          onChange={(e) => setFilterAud(e.target.value)}
          className="field text-sm py-2"
        >
          <option value="">{t('adminArticles.allAudiences')}</option>
          {AUDIENCE_OPTION_KEYS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
        </select>
      </div>

      {/* ── Article list ── */}
      <SectionCard>
        {isLoading ? (
          <div className="py-10 text-center text-text-faint text-sm">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t('adminArticles.noneFound')}
            description={
              search || filterCat || filterAud
                ? t('common.noResultsFilters')
                : tab === 'all'
                  ? t('adminArticles.createFirstHint')
                  : t('adminArticles.noneInTab')
            }
          />
        ) : (
          <div className="divide-y divide-line">
            {filtered.map(a => (
              <ArticleCard
                key={a.id}
                article={a}
                onEdit={()      => openEdit(a)}
                onPreview={()   => setPreviewArt(a)}
                onPublish={()   => publishMut.mutate(a.id)}
                onArchive={()   => archiveMut.mutate(a.id)}
                onDuplicate={() => dupMut.mutate(a)}
                onDelete={()    => setDelConfirm(a)}
                publishing={publishMut.isPending && publishMut.variables === a.id}
                archiving={archiveMut.isPending && archiveMut.variables === a.id}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Delete confirm ── */}
      <ConfirmDialog
        open={!!delConfirm}
        onClose={() => setDelConfirm(null)}
        onConfirm={() => delConfirm && deleteMut.mutate(delConfirm.id)}
        title={t('adminArticles.deleteTitle')}
        message={t('adminArticles.deleteMessage', { title: delConfirm?.title ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        loading={deleteMut.isPending}
      />

      {/* ── Preview ── */}
      {previewArt && (
        <PreviewModal
          article={previewArt}
          blocks={Array.isArray(previewArt.body_blocks) ? previewArt.body_blocks : []}
          open={!!previewArt}
          onClose={() => setPreviewArt(null)}
        />
      )}
    </PageWrapper>
  )
}
