import { useState, useRef, useEffect, type ReactNode } from 'react'
import { supabase } from '@/services/supabase'
import { compressImage, compressPresets } from '@/lib/imageCompress'
import { Input, Textarea, Select } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'
import { uid } from '@/utils/uid'
import type { ArticleBlock, ArticleBlockType } from '@/types'

// ─── MAPS ─────────────────────────────────────────────────────────────────────

const FONT_SIZE: Record<string, string> = {
  small: '0.8rem',
  normal: '1rem',
  medium: '1.1rem',
  large: '1.25rem',
  xl: '1.5rem',
}

const FONT_FAMILY: Record<string, string> = {
  system:  'inherit',
  arial:   'Arial, sans-serif',
  inter:   '"Inter", sans-serif',
  roboto:  '"Roboto", sans-serif',
  georgia: 'Georgia, serif',
  times:   '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
}

const BLOCK_LABEL_KEYS: Partial<Record<ArticleBlockType, string>> = {
  paragraph: 'blockEditor.paragraph',
  heading:   'blockEditor.heading',
  image:     'blockEditor.image',
  gallery:   'blockEditor.gallery',
  video:     'blockEditor.video',
  quote:     'blockEditor.quoteCallout',
  linkbtn:   'blockEditor.linkButton',
  divider:   'blockEditor.divider',
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sanitize(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    doc.querySelectorAll('script,iframe,object,embed,form').forEach(el => el.remove())
    doc.querySelectorAll('*').forEach(el => {
      const unsafe = ['onclick','onload','onerror','onmouseover','onmouseout',
        'onfocus','onblur','onkeydown','onkeyup','onkeypress','onsubmit']
      unsafe.forEach(attr => el.removeAttribute(attr))
      const href = el.getAttribute('href') ?? ''
      if (/^javascript:|^data:/i.test(href)) el.removeAttribute('href')
    })
    return doc.body.innerHTML
  } catch {
    return ''
  }
}

function getVideoEmbed(url: string): { embedUrl: string; provider: string } | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  if (yt) return { embedUrl: `https://www.youtube.com/embed/${yt[1]}`, provider: 'YouTube' }
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return { embedUrl: `https://player.vimeo.com/video/${vm[1]}`, provider: 'Vimeo' }
  return null
}

function newBlock(type: ArticleBlockType): ArticleBlock {
  return { id: uid(), type, html: '', content: '' }
}

// ─── UPLOAD ───────────────────────────────────────────────────────────────────

export async function uploadArticleImage(
  file: File,
  articleSlug: string,
  subfolder = '',
): Promise<string> {
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
  if (!allowed.includes(file.type)) {
    // Thrown to callers that surface it via a translated toast; keep English here
    // (this runs outside React and has no access to the language context).
    throw new Error('Invalid file type. Please upload PNG, JPG, or WebP.')
  }
  // Covers + body images are auto-compressed (transparent PNGs stay PNG).
  const upload = await compressImage(file, compressPresets.articleImage)
  const ts = Date.now()
  const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${articleSlug || 'draft'}/${subfolder}${ts}-${safeName}`
  const { error } = await supabase.storage.from('articles').upload(path, upload, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from('articles').getPublicUrl(path)
  return data.publicUrl
}

// ─── RICH TEXT TOOLBAR ────────────────────────────────────────────────────────

interface RichToolbarProps {
  block: ArticleBlock
  onBlockChange: (updates: Partial<ArticleBlock>) => void
  isHeading?: boolean
}

function TBtn({ title, onMD, active, children }: { title: string; onMD: () => void; active?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onMD() }}
      className={cn(
        'w-7 h-7 flex items-center justify-center rounded text-[11px] font-semibold select-none',
        active ? 'bg-primary-soft text-primary' : 'text-text-dim hover:bg-surface-soft hover:text-text',
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="w-px h-5 bg-line mx-0.5 shrink-0" />
}

function RichToolbar({ block, onBlockChange, isHeading = false }: RichToolbarProps) {
  const { t } = useLanguage()

  // Reflect the current selection's active formatting so B/I/U/S light up.
  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false, strike: false })
  useEffect(() => {
    const update = () => {
      try {
        setFmt({
          bold:      document.queryCommandState('bold'),
          italic:    document.queryCommandState('italic'),
          underline: document.queryCommandState('underline'),
          strike:    document.queryCommandState('strikeThrough'),
        })
      } catch { /* queryCommandState can throw when nothing is focused */ }
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])

  function exec(cmd: string, val?: string) {
    document.execCommand(cmd, false, val ?? undefined)
    // Re-sync active states immediately after a toggle.
    try {
      setFmt({
        bold:      document.queryCommandState('bold'),
        italic:    document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike:    document.queryCommandState('strikeThrough'),
      })
    } catch { /* ignore */ }
  }

  const alignIcons: Record<string, string> = {
    left: '⬅', center: '↔', right: '➡', justify: '☰',
  }
  const alignTitles: Record<string, string> = {
    left: t('blockEditor.alignLeft'), center: t('blockEditor.alignCenter'),
    right: t('blockEditor.alignRight'), justify: t('blockEditor.alignJustify'),
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1 bg-section border-b border-line">

      {/* Heading level */}
      {isHeading && (
        <select
          value={block.level ?? 2}
          onChange={(e) => onBlockChange({ level: Number(e.target.value) as 1 | 2 | 3 })}
          className="h-7 text-[11px] bg-surface border border-line rounded px-1 text-text cursor-pointer"
        >
          <option value={1}>H1</option>
          <option value={2}>H2</option>
          <option value={3}>H3</option>
        </select>
      )}

      {/* Font size (paragraph only) */}
      {!isHeading && (
        <select
          value={block.fontSize ?? 'normal'}
          onChange={(e) => onBlockChange({ fontSize: e.target.value as ArticleBlock['fontSize'] })}
          className="h-7 text-[11px] bg-surface border border-line rounded px-1 text-text cursor-pointer"
        >
          <option value="small">{t('blockEditor.sizeSmall')}</option>
          <option value="normal">{t('blockEditor.sizeNormal')}</option>
          <option value="medium">{t('blockEditor.sizeMedium')}</option>
          <option value="large">{t('blockEditor.sizeLarge')}</option>
          <option value="xl">{t('blockEditor.sizeXl')}</option>
        </select>
      )}

      {/* Font family (paragraph only) */}
      {!isHeading && (
        <select
          value={block.fontFamily ?? 'system'}
          onChange={(e) => onBlockChange({ fontFamily: e.target.value })}
          className="h-7 text-[11px] bg-surface border border-line rounded px-1 text-text cursor-pointer max-w-[100px]"
        >
          <option value="system">{t('blockEditor.fontSystem')}</option>
          <option value="arial">Arial</option>
          <option value="inter">Inter</option>
          <option value="roboto">Roboto</option>
          <option value="georgia">Georgia</option>
          <option value="times">Times NR</option>
          <option value="courier">Courier</option>
        </select>
      )}

      <Divider />

      {/* Alignment */}
      {(['left', 'center', 'right', 'justify'] as const).map(a => (
        <button
          key={a}
          type="button"
          title={alignTitles[a]}
          onMouseDown={(e) => { e.preventDefault(); onBlockChange({ align: a }) }}
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded text-[11px] hover:bg-surface-soft',
            block.align === a ? 'bg-primary-soft text-primary' : 'text-text-dim',
          )}
        >
          {alignIcons[a]}
        </button>
      ))}

      <Divider />

      {/* Inline formatting */}
      <TBtn title={t('blockEditor.bold')}          active={fmt.bold}      onMD={() => exec('bold')}><strong>B</strong></TBtn>
      <TBtn title={t('blockEditor.italic')}        active={fmt.italic}    onMD={() => exec('italic')}><em>I</em></TBtn>
      <TBtn title={t('blockEditor.underline')}     active={fmt.underline} onMD={() => exec('underline')}><u>U</u></TBtn>
      <TBtn title={t('blockEditor.strikethrough')} active={fmt.strike}    onMD={() => exec('strikeThrough')}><s>S</s></TBtn>

      <Divider />

      <TBtn title={t('blockEditor.bulletList')}   onMD={() => exec('insertUnorderedList')}>•</TBtn>
      <TBtn title={t('blockEditor.numberedList')} onMD={() => exec('insertOrderedList')}>1.</TBtn>

      <Divider />

      <TBtn
        title={t('blockEditor.insertLink')}
        onMD={() => {
          const url = window.prompt(t('blockEditor.enterUrl'))
          if (url) exec('createLink', url)
        }}
      >
        🔗
      </TBtn>
      <TBtn title={t('blockEditor.removeLink')}        onMD={() => exec('unlink')}>✂🔗</TBtn>
      <TBtn title={t('blockEditor.clearFormatting')}   onMD={() => exec('removeFormat')}>T×</TBtn>
    </div>
  )
}

// ─── RICH TEXT CONTENTEDITABLE ────────────────────────────────────────────────

interface RichEditProps {
  initialHtml: string
  onHtmlChange: (html: string) => void
  style?: React.CSSProperties
  placeholder?: string
  className?: string
}

function RichEdit({ initialHtml, onHtmlChange, style, placeholder, className }: RichEditProps) {
  const ref = useRef<HTMLDivElement>(null)
  const initRef = useRef(initialHtml)

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initRef.current
  }, []) // set once on mount — contenteditable owns DOM from here

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={(e) => onHtmlChange(e.currentTarget.innerHTML)}
      style={style}
      className={cn(
        'p-3 focus:outline-none leading-relaxed text-text min-h-[44px] empty:before:content-[attr(data-placeholder)] empty:before:text-text-faint',
        className,
      )}
    />
  )
}

// ─── PARAGRAPH EDITOR ─────────────────────────────────────────────────────────

function ParagraphEditor({
  block,
  onChange,
}: {
  block: ArticleBlock
  onChange: (u: Partial<ArticleBlock>) => void
}) {
  const { t } = useLanguage()
  return (
    <div className="border border-line rounded-[var(--r)] overflow-hidden">
      <RichToolbar block={block} onBlockChange={onChange} />
      <RichEdit
        initialHtml={block.html ?? block.content ?? ''}
        onHtmlChange={(html) => onChange({ html })}
        placeholder={t('blockEditor.paragraphPlaceholder')}
        style={{
          fontSize:   FONT_SIZE[block.fontSize ?? 'normal'],
          fontFamily: FONT_FAMILY[block.fontFamily ?? 'system'],
          textAlign:  block.align ?? 'left',
        }}
      />
    </div>
  )
}

// ─── HEADING EDITOR ───────────────────────────────────────────────────────────

function HeadingEditor({
  block,
  onChange,
}: {
  block: ArticleBlock
  onChange: (u: Partial<ArticleBlock>) => void
}) {
  const { t } = useLanguage()
  const lvl = block.level ?? 2
  const sizeClass = lvl === 1 ? 'text-3xl' : lvl === 3 ? 'text-lg' : 'text-2xl'

  return (
    <div className="border border-line rounded-[var(--r)] overflow-hidden">
      <RichToolbar block={block} onBlockChange={onChange} isHeading />
      <RichEdit
        initialHtml={block.html ?? block.content ?? ''}
        onHtmlChange={(html) => onChange({ html })}
        placeholder={t('blockEditor.headingPlaceholder')}
        style={{ textAlign: block.align ?? 'left' }}
        className={cn('font-display font-semibold', sizeClass)}
      />
    </div>
  )
}

// ─── IMAGE BLOCK EDITOR ───────────────────────────────────────────────────────

function ImageEditor({
  block,
  onChange,
  articleSlug,
  onError,
}: {
  block: ArticleBlock
  onChange: (u: Partial<ArticleBlock>) => void
  articleSlug: string
  onError: (msg: string) => void
}) {
  const { t } = useLanguage()
  const [uploading, setUploading] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadArticleImage(file, articleSlug)
      onChange({ url })
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : t('common.actionFailed'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-3 p-3 bg-section rounded-[var(--r)]">
      {block.url ? (
        <div className="relative group">
          <img
            src={block.url}
            alt={block.alt ?? ''}
            className="max-h-64 max-w-full rounded-[var(--r-sm)] object-contain"
          />
          <button
            type="button"
            onClick={() => onChange({ url: undefined })}
            className="absolute top-2 right-2 bg-danger text-white text-xs px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {t('common.remove')}
          </button>
        </div>
      ) : (
        <label
          className={cn(
            'flex flex-col items-center justify-center h-32 border-2 border-dashed border-line rounded-[var(--r)] cursor-pointer',
            'hover:border-primary hover:bg-primary-soft/10 transition-colors',
            uploading && 'opacity-50 pointer-events-none',
          )}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            onChange={handleFile}
            className="sr-only"
          />
          <span className="text-text-faint text-sm">
            {uploading ? t('common.uploading') : t('blockEditor.clickUploadImage')}
          </span>
          <span className="text-text-faint text-xs mt-1">{t('blockEditor.imageFormats')}</span>
        </label>
      )}
      <Input
        label={t('blockEditor.altText')}
        value={block.alt ?? ''}
        onChange={(e) => onChange({ alt: e.target.value })}
        placeholder={t('blockEditor.altPlaceholder')}
      />
      <Input
        label={t('blockEditor.captionOptional')}
        value={block.caption ?? ''}
        onChange={(e) => onChange({ caption: e.target.value })}
        placeholder={t('blockEditor.captionPlaceholder')}
      />
    </div>
  )
}

// ─── GALLERY BLOCK EDITOR ─────────────────────────────────────────────────────

type GalleryImg = { url: string; alt?: string; caption?: string }

function GalleryEditor({
  block,
  onChange,
  articleSlug,
  onError,
}: {
  block: ArticleBlock
  onChange: (u: Partial<ArticleBlock>) => void
  articleSlug: string
  onError: (msg: string) => void
}) {
  const { t } = useLanguage()
  const [uploading, setUploading] = useState(false)
  const images: GalleryImg[] = block.images ?? []

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setUploading(true)
    try {
      const urls = await Promise.all(
        files.map(f => uploadArticleImage(f, articleSlug, 'gallery/')),
      )
      const added: GalleryImg[] = urls.map(url => ({ url, alt: '', caption: '' }))
      onChange({ images: [...images, ...added] })
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : t('common.actionFailed'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function remove(idx: number) {
    onChange({ images: images.filter((_, i) => i !== idx) })
  }

  function move(idx: number, dir: -1 | 1) {
    const arr = [...images]
    const ni = idx + dir
    if (ni < 0 || ni >= arr.length) return
    ;[arr[idx], arr[ni]] = [arr[ni], arr[idx]]
    onChange({ images: arr })
  }

  function updateImg(idx: number, updates: Partial<GalleryImg>) {
    onChange({ images: images.map((img, i) => (i === idx ? { ...img, ...updates } : img)) })
  }

  return (
    <div className="space-y-3 p-3 bg-section rounded-[var(--r)]">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {images.map((img, idx) => (
          <div key={idx} className="space-y-1">
            <div className="relative group">
              <img
                src={img.url}
                alt={img.alt ?? ''}
                className="w-full h-24 object-cover rounded-[var(--r-sm)]"
              />
              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {idx > 0 && (
                  <button type="button" onClick={() => move(idx, -1)}
                    className="bg-surface border border-line text-text-dim rounded px-1 text-xs"
                  >←</button>
                )}
                {idx < images.length - 1 && (
                  <button type="button" onClick={() => move(idx, 1)}
                    className="bg-surface border border-line text-text-dim rounded px-1 text-xs"
                  >→</button>
                )}
                <button type="button" onClick={() => remove(idx)}
                  className="bg-danger text-white rounded px-1 text-xs"
                >×</button>
              </div>
            </div>
            <input
              value={img.caption ?? ''}
              onChange={(e) => updateImg(idx, { caption: e.target.value })}
              placeholder={t('blockEditor.caption')}
              className="field text-xs py-1 w-full"
            />
          </div>
        ))}

        {/* Upload trigger */}
        <label
          className={cn(
            'flex flex-col items-center justify-center h-24 border-2 border-dashed border-line rounded-[var(--r)] cursor-pointer',
            'hover:border-primary hover:bg-primary-soft/10 transition-colors',
            uploading && 'opacity-50 pointer-events-none',
          )}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            multiple
            onChange={handleFiles}
            className="sr-only"
          />
          <span className="text-text-faint text-xs text-center px-1">
            {uploading ? t('common.uploading') : `+ ${t('blockEditor.addImages')}`}
          </span>
        </label>
      </div>
    </div>
  )
}

// ─── VIDEO BLOCK EDITOR ───────────────────────────────────────────────────────

function VideoEditor({
  block,
  onChange,
}: {
  block: ArticleBlock
  onChange: (u: Partial<ArticleBlock>) => void
}) {
  const { t } = useLanguage()
  const embed = block.videoUrl ? getVideoEmbed(block.videoUrl) : null

  return (
    <div className="space-y-3 p-3 bg-section rounded-[var(--r)]">
      <Input
        label={t('blockEditor.videoUrl')}
        value={block.videoUrl ?? ''}
        onChange={(e) => onChange({ videoUrl: e.target.value })}
        placeholder="https://youtube.com/watch?v=…  or  https://vimeo.com/…"
      />
      <Input
        label={t('blockEditor.titleOptional')}
        value={block.title ?? ''}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder={t('blockEditor.videoTitle')}
      />
      <Input
        label={t('blockEditor.captionOptional')}
        value={block.caption ?? ''}
        onChange={(e) => onChange({ caption: e.target.value })}
        placeholder={t('blockEditor.optionalCaption')}
      />
      {embed && (
        <div className="relative aspect-video rounded-[var(--r)] overflow-hidden border border-line bg-black">
          <iframe
            src={embed.embedUrl}
            title={block.title ?? t('blockEditor.videoPreview')}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      {block.videoUrl && !embed && (
        <p className="text-xs text-warning bg-warning-soft/30 px-3 py-2 rounded-[var(--r-sm)]">
          {t('blockEditor.unrecognizedVideo')}
        </p>
      )}
    </div>
  )
}

// ─── QUOTE / CALLOUT EDITOR ───────────────────────────────────────────────────

function QuoteEditor({
  block,
  onChange,
}: {
  block: ArticleBlock
  onChange: (u: Partial<ArticleBlock>) => void
}) {
  const { t } = useLanguage()
  return (
    <div className="space-y-3 p-3 bg-section rounded-[var(--r)]">
      <Textarea
        label={t('blockEditor.quoteText')}
        value={block.content ?? ''}
        onChange={(e) => onChange({ content: e.target.value })}
        placeholder={t('blockEditor.enterText')}
        minRows={3}
      />
      <Input
        label={t('blockEditor.authorSource')}
        value={block.cite ?? ''}
        onChange={(e) => onChange({ cite: e.target.value })}
        placeholder={t('blockEditor.authorPlaceholder')}
      />
      <Select
        label={t('blockEditor.style')}
        value={block.quoteStyle ?? 'note'}
        onChange={(e) => onChange({ quoteStyle: e.target.value as ArticleBlock['quoteStyle'] })}
        options={[
          { value: 'note',    label: t('blockEditor.styleNote') },
          { value: 'info',    label: t('blockEditor.styleInfo') },
          { value: 'warning', label: t('blockEditor.styleWarning') },
          { value: 'success', label: t('blockEditor.styleSuccess') },
        ]}
      />
    </div>
  )
}

// ─── LINK BUTTON EDITOR ───────────────────────────────────────────────────────

function LinkBtnEditor({
  block,
  onChange,
}: {
  block: ArticleBlock
  onChange: (u: Partial<ArticleBlock>) => void
}) {
  const { t } = useLanguage()
  return (
    <div className="space-y-3 p-3 bg-section rounded-[var(--r)]">
      <Input
        label={t('blockEditor.buttonLabel')}
        value={block.label ?? ''}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder={t('blockEditor.clickHere')}
      />
      <Input
        label="URL"
        value={block.url ?? ''}
        onChange={(e) => onChange({ url: e.target.value })}
        placeholder="https://…"
      />
      <Select
        label={t('blockEditor.style')}
        value={block.btnStyle ?? 'primary'}
        onChange={(e) => onChange({ btnStyle: e.target.value as ArticleBlock['btnStyle'] })}
        options={[
          { value: 'primary',   label: t('branding.primary') },
          { value: 'secondary', label: t('branding.secondary') },
          { value: 'outline',   label: t('blockEditor.styleOutline') },
        ]}
      />
      {/* Preview */}
      {block.label && (
        <div className="flex justify-center pt-1">
          <span
            className={cn(
              'inline-flex items-center px-5 py-2 text-sm font-semibold rounded-[var(--r)] pointer-events-none',
              block.btnStyle === 'outline'   && 'border border-line-strong text-text-dim',
              block.btnStyle === 'secondary' && 'bg-text text-bg',
              (!block.btnStyle || block.btnStyle === 'primary') && 'bg-primary text-primary-on',
            )}
          >
            {block.label}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── ADD BLOCK PICKER ─────────────────────────────────────────────────────────

const BLOCK_TYPES: { type: ArticleBlockType; labelKey: string; icon: string }[] = [
  { type: 'paragraph', labelKey: 'blockEditor.paragraph', icon: '¶' },
  { type: 'heading',   labelKey: 'blockEditor.heading',   icon: 'H' },
  { type: 'image',     labelKey: 'blockEditor.image',     icon: '🖼' },
  { type: 'gallery',   labelKey: 'blockEditor.gallery',   icon: '⊞' },
  { type: 'video',     labelKey: 'blockEditor.video',     icon: '▶' },
  { type: 'quote',     labelKey: 'blockEditor.quote',     icon: '"' },
  { type: 'linkbtn',   labelKey: 'blockEditor.linkBtn',  icon: '⬡' },
  { type: 'divider',   labelKey: 'blockEditor.divider',   icon: '─' },
]

function AddBlockPicker({
  onAdd,
  onClose,
}: {
  onAdd: (type: ArticleBlockType) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  return (
    <div className="border border-line bg-surface rounded-[var(--r)] p-3 shadow-card-lg w-full">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-text-dim">{t('blockEditor.addBlock')}</span>
        <button type="button" onClick={onClose} className="text-text-faint hover:text-text text-xs">
          {t('common.cancel')}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {BLOCK_TYPES.map(({ type, labelKey, icon }) => (
          <button
            key={type}
            type="button"
            onClick={() => onAdd(type)}
            className="flex flex-col items-center gap-1 p-2 rounded-[var(--r-sm)] border border-line hover:border-primary hover:bg-primary-soft/10 transition-colors"
          >
            <span className="text-base leading-none">{icon}</span>
            <span className="text-[10px] text-text-dim leading-tight text-center">{t(labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── BLOCK PREVIEW ────────────────────────────────────────────────────────────

export function BlockPreview({ block }: { block: ArticleBlock }) {
  const { t } = useLanguage()
  switch (block.type) {
    case 'paragraph':
      return (
        <div
          style={{
            fontSize:   FONT_SIZE[block.fontSize ?? 'normal'],
            fontFamily: FONT_FAMILY[block.fontFamily ?? 'system'],
            textAlign:  block.align ?? 'left',
          }}
          className="leading-relaxed text-text"
          dangerouslySetInnerHTML={{ __html: sanitize(block.html ?? block.content ?? '') }}
        />
      )

    case 'heading': {
      const Tag = block.level === 1 ? 'h1' : block.level === 3 ? 'h3' : 'h2'
      return (
        <Tag
          style={{ textAlign: block.align ?? 'left' }}
          className="font-display font-semibold text-text"
          dangerouslySetInnerHTML={{ __html: sanitize(block.html ?? block.content ?? '') }}
        />
      )
    }

    case 'image':
      return (
        <figure className="my-2">
          {block.url && (
            <img src={block.url} alt={block.alt ?? ''} className="max-w-full rounded-[var(--r)] mx-auto" />
          )}
          {block.caption && (
            <figcaption className="text-xs text-text-faint text-center mt-2 italic">
              {block.caption}
            </figcaption>
          )}
        </figure>
      )

    case 'gallery':
    case 'carousel': {
      const imgs = block.images ?? []
      if (!imgs.length) return null
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 my-2">
          {imgs.map((img, i) => (
            <figure key={i} className="m-0">
              <img
                src={img.url}
                alt={img.alt ?? ''}
                className="w-full h-40 object-cover rounded-[var(--r-sm)]"
              />
              {img.caption && (
                <figcaption className="text-xs text-text-faint mt-1 italic">{img.caption}</figcaption>
              )}
            </figure>
          ))}
        </div>
      )
    }

    case 'video': {
      const embed = block.videoUrl ? getVideoEmbed(block.videoUrl) : null
      if (!embed) return null
      return (
        <figure className="my-2">
          <div className="relative aspect-video rounded-[var(--r)] overflow-hidden border border-line bg-black">
            <iframe
              src={embed.embedUrl}
              title={block.title ?? 'Video'}
              className="w-full h-full"
              allowFullScreen
            />
          </div>
          {(block.title || block.caption) && (
            <figcaption className="text-xs text-text-faint text-center mt-2 italic">
              {[block.title, block.caption].filter(Boolean).join(' — ')}
            </figcaption>
          )}
        </figure>
      )
    }

    case 'quote':
    case 'pullquote': {
      const styleMap: Record<string, string> = {
        info:    'border-primary bg-primary-soft/20',
        warning: 'border-warning bg-warning-soft/20',
        success: 'border-success bg-success-soft/20',
        note:    'border-line-strong bg-section',
      }
      const cls = styleMap[block.quoteStyle ?? 'note']
      return (
        <blockquote className={cn('border-l-4 pl-4 py-2 rounded-r-[var(--r-sm)] my-2', cls)}>
          <p className="text-text leading-relaxed">{block.content ?? ''}</p>
          {block.cite && (
            <cite className="text-xs text-text-faint mt-1 block not-italic">
              — {block.cite}
            </cite>
          )}
        </blockquote>
      )
    }

    case 'linkbtn':
    case 'cta':
    case 'linkcard': {
      const variantCls =
        block.btnStyle === 'outline'   ? 'border border-line-strong text-text-dim' :
        block.btnStyle === 'secondary' ? 'bg-text text-bg' :
                                          'bg-primary text-primary-on'
      return (
        <div className="my-3 flex justify-center">
          <a
            href={block.url ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center px-5 py-2.5 text-sm font-semibold rounded-[var(--r)] transition-opacity hover:opacity-80',
              variantCls,
            )}
          >
            {block.label ?? t('blockEditor.readMore')}
          </a>
        </div>
      )
    }

    case 'divider':
      return <hr className="border-line my-4" />

    default:
      return null
  }
}

export function ArticleBodyPreview({ blocks }: { blocks: ArticleBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map(b => <BlockPreview key={b.id} block={b} />)}
    </div>
  )
}

// ─── MAIN BLOCK EDITOR ────────────────────────────────────────────────────────

export interface BlockEditorProps {
  blocks: ArticleBlock[]
  onChange: (blocks: ArticleBlock[]) => void
  articleSlug: string
  onError: (msg: string) => void
}

export function BlockEditor({ blocks, onChange, articleSlug, onError }: BlockEditorProps) {
  const { t } = useLanguage()
  const [addingAfter, setAddingAfter]   = useState<string | null>(null)
  const [addingBefore, setAddingBefore] = useState<string | null>(null)

  function update(id: string, updates: Partial<ArticleBlock>) {
    onChange(blocks.map(b => (b.id === id ? { ...b, ...updates } : b)))
  }

  function move(id: string, dir: -1 | 1) {
    const idx = blocks.findIndex(b => b.id === id)
    if (idx < 0) return
    const ni = idx + dir
    if (ni < 0 || ni >= blocks.length) return
    const arr = [...blocks]
    ;[arr[idx], arr[ni]] = [arr[ni], arr[idx]]
    onChange(arr)
  }

  function del(id: string) {
    onChange(blocks.filter(b => b.id !== id))
  }

  function duplicate(id: string) {
    const idx = blocks.findIndex(b => b.id === id)
    if (idx < 0) return
    const dup: ArticleBlock = { ...blocks[idx], id: uid() }
    const arr = [...blocks]
    arr.splice(idx + 1, 0, dup)
    onChange(arr)
  }

  function addBlock(type: ArticleBlockType, afterId: string | null) {
    const block = newBlock(type)
    if (afterId === null) {
      onChange([...blocks, block])
    } else {
      const idx = blocks.findIndex(b => b.id === afterId)
      const arr = [...blocks]
      arr.splice(idx + 1, 0, block)
      onChange(arr)
    }
    setAddingAfter(null)
    setAddingBefore(null)
  }

  function addBlockBefore(type: ArticleBlockType, beforeId: string) {
    const b = newBlock(type)
    const idx = blocks.findIndex(bl => bl.id === beforeId)
    const arr = [...blocks]
    arr.splice(idx, 0, b)
    onChange(arr)
    setAddingBefore(null)
  }

  function renderEditor(block: ArticleBlock) {
    const upd = (u: Partial<ArticleBlock>) => update(block.id, u)
    switch (block.type) {
      case 'paragraph':
        return <ParagraphEditor key={block.id} block={block} onChange={upd} />
      case 'heading':
        return <HeadingEditor key={block.id} block={block} onChange={upd} />
      case 'image':
        return <ImageEditor block={block} onChange={upd} articleSlug={articleSlug} onError={onError} />
      case 'gallery':
      case 'carousel':
        return <GalleryEditor block={block} onChange={upd} articleSlug={articleSlug} onError={onError} />
      case 'video':
        return <VideoEditor block={block} onChange={upd} />
      case 'quote':
      case 'pullquote':
        return <QuoteEditor block={block} onChange={upd} />
      case 'linkbtn':
      case 'cta':
      case 'linkcard':
        return <LinkBtnEditor block={block} onChange={upd} />
      case 'divider':
        return (
          <div className="py-3 px-4 bg-section rounded-[var(--r)] flex items-center gap-2">
            <hr className="flex-1 border-line" />
            <span className="text-xs text-text-faint">{t('blockEditor.divider')}</span>
            <hr className="flex-1 border-line" />
          </div>
        )
      default:
        return (
          <div className="p-3 bg-section rounded-[var(--r)] text-text-faint text-sm">
            {t('blockEditor.blockLabel', { type: block.type })}
          </div>
        )
    }
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, idx) => (
        <div key={block.id} className="group">
          {/* Add block above zone */}
          {addingBefore === block.id && (
            <div className="mb-2">
              <AddBlockPicker
                onAdd={(t) => addBlockBefore(t, block.id)}
                onClose={() => setAddingBefore(null)}
              />
            </div>
          )}

          {/* Block header row */}
          <div className="flex items-center justify-between mb-1 px-0.5">
            <span className="text-[10px] text-text-faint uppercase tracking-widest font-semibold">
              {BLOCK_LABEL_KEYS[block.type] ? t(BLOCK_LABEL_KEYS[block.type]!) : block.type}
            </span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={() => { setAddingAfter(null); setAddingBefore(block.id) }}
                title={t('blockEditor.addAbove')}
                className="w-6 h-6 rounded text-text-faint hover:text-primary hover:bg-surface-soft flex items-center justify-center text-xs"
              >⊕</button>
              <button
                type="button"
                onClick={() => move(block.id, -1)}
                disabled={idx === 0}
                title={t('blockEditor.moveUp')}
                className="w-6 h-6 rounded text-text-faint hover:text-text hover:bg-surface-soft flex items-center justify-center disabled:opacity-30 text-xs"
              >↑</button>
              <button
                type="button"
                onClick={() => move(block.id, 1)}
                disabled={idx === blocks.length - 1}
                title={t('blockEditor.moveDown')}
                className="w-6 h-6 rounded text-text-faint hover:text-text hover:bg-surface-soft flex items-center justify-center disabled:opacity-30 text-xs"
              >↓</button>
              <button
                type="button"
                onClick={() => duplicate(block.id)}
                title={t('blockEditor.duplicateBlock')}
                className="w-6 h-6 rounded text-text-faint hover:text-text hover:bg-surface-soft flex items-center justify-center text-xs"
              >⧉</button>
              <button
                type="button"
                onClick={() => del(block.id)}
                title={t('blockEditor.deleteBlock')}
                className="w-6 h-6 rounded text-danger hover:bg-danger-soft flex items-center justify-center text-sm"
              >×</button>
            </div>
          </div>

          {/* Block content */}
          {renderEditor(block)}

          {/* Add block below */}
          <div className="mt-2 flex justify-center min-h-[24px]">
            {addingAfter === block.id ? (
              <div className="w-full">
                <AddBlockPicker
                  onAdd={(t) => addBlock(t, block.id)}
                  onClose={() => setAddingAfter(null)}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAddingBefore(null); setAddingAfter(block.id) }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-text-faint hover:text-primary flex items-center gap-1"
              >
                + {t('blockEditor.addBlockLower')}
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Add block at end */}
      {addingAfter === '__end__' ? (
        <AddBlockPicker
          onAdd={(t) => addBlock(t, null)}
          onClose={() => setAddingAfter(null)}
        />
      ) : (
        <button
          type="button"
          onClick={() => { setAddingBefore(null); setAddingAfter('__end__') }}
          className="w-full py-3 border-2 border-dashed border-line rounded-[var(--r)] text-text-faint hover:border-primary hover:text-primary hover:bg-primary-soft/10 transition-colors text-sm"
        >
          + {t('blockEditor.addBlock')}
        </button>
      )}
    </div>
  )
}
