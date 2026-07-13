/**
 * Client-side image compression for uploads.
 *
 * Every photo upload in the app (score proofs, cert proofs, avatars, covers,
 * badges, branding) previously sent the raw camera file — often 3–10 MB — to
 * Supabase Storage. compressImage() resizes to a sensible max edge and
 * re-encodes before upload, typically cutting a phone photo to a few hundred
 * KB. It is deliberately fail-open: anything that can't be (or shouldn't be)
 * compressed comes back unchanged, so an upload never breaks because of this
 * step.
 *
 * Passthrough (returned as-is):
 *   • non-images (PDFs etc. — several inputs accept .pdf)
 *   • SVG (vector — rasterizing would break logos), GIF (would lose
 *     animation), ICO
 *   • files already at/under `skipUnderBytes`
 *   • any decode/encode failure (e.g. exotic formats the browser can't read)
 *   • results that end up LARGER than the original (canvas PNG re-encoding
 *     of an already-optimized file can grow it — we always keep the smaller)
 *
 * Output format:
 *   • 'jpeg'  — force JPEG (photos; transparent regions flattened onto white)
 *   • 'png'   — force PNG (badge art where transparency is required)
 *   • 'auto'  — sample the alpha channel: transparent → PNG, opaque → JPEG
 *
 * Re-encoding also strips EXIF (GPS etc. — a privacy win) and bakes the EXIF
 * orientation into the pixels, so proofs no longer show up rotated.
 */

export interface CompressImageOptions {
  /** Longest-edge cap in px; larger images are scaled down. Default 1920. */
  maxDimension?: number
  /** JPEG quality 0–1 (ignored for PNG output). Default 0.82. */
  quality?: number
  /** Output strategy — see module docs. Default 'auto'. */
  format?: 'auto' | 'jpeg' | 'png'
  /** Files at/under this size skip compression entirely. Default 150 KB. */
  skipUnderBytes?: number
}

/** Per-upload-path presets so call sites stay declarative. */
export const compressPresets = {
  /** Score / cert / change-request proof photos — phone camera shots. */
  proofPhoto:         { maxDimension: 2000, quality: 0.8,  format: 'jpeg' },
  /** Profile avatars — displayed small everywhere. */
  avatar:             { maxDimension: 512,  quality: 0.85, format: 'jpeg' },
  /** Achievement badge art — must keep transparency. */
  badge:              { maxDimension: 512,  format: 'png' },
  /** Logos / favicons — transparency preserved when present. */
  brandingAsset:      { maxDimension: 1024, quality: 0.85, format: 'auto' },
  /** Login/background imagery — large photographic assets. */
  brandingBackground: { maxDimension: 1920, quality: 0.82, format: 'auto' },
  /** Article bodies + article/notification covers. */
  articleImage:       { maxDimension: 1920, quality: 0.82, format: 'auto' },
} as const satisfies Record<string, CompressImageOptions>

const PASSTHROUGH_TYPES = new Set([
  'image/svg+xml',
  'image/gif',
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

/**
 * Compress an image File for upload. Resolves to a new File (JPEG or PNG,
 * extension corrected to match) — or the ORIGINAL file whenever compression
 * is not applicable or not a win. Never rejects for image-processing reasons.
 */
export async function compressImage(
  file: File,
  opts: CompressImageOptions = {},
): Promise<File> {
  const {
    maxDimension = 1920,
    quality = 0.82,
    format = 'auto',
    skipUnderBytes = 150 * 1024,
  } = opts

  try {
    if (!file.type.startsWith('image/') || PASSTHROUGH_TYPES.has(file.type)) return file
    if (file.size <= skipUnderBytes) return file

    const source = await decodeImage(file)
    if (!source) return file

    const sw = source.width
    const sh = source.height
    if (!sw || !sh) return file

    const scale = Math.min(1, maxDimension / Math.max(sw, sh))
    const dw = Math.max(1, Math.round(sw * scale))
    const dh = Math.max(1, Math.round(sh * scale))

    const canvas = document.createElement('canvas')
    canvas.width = dw
    canvas.height = dh
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    let outType: 'image/jpeg' | 'image/png'
    if (format === 'jpeg') {
      // Flatten possible transparency onto white (JPEG would render it black).
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, dw, dh)
      ctx.drawImage(source, 0, 0, dw, dh)
      outType = 'image/jpeg'
    } else {
      ctx.drawImage(source, 0, 0, dw, dh)
      outType =
        format === 'png' ? 'image/png'
        : hasTransparency(ctx, dw, dh) ? 'image/png'
        : 'image/jpeg'
    }

    if ('close' in source) source.close()

    const blob = await canvasToBlob(canvas, outType, quality)
    if (!blob || blob.size <= 0) return file

    // Only ship the re-encode when it actually saves bytes.
    if (blob.size >= file.size) return file

    return new File([blob], renameForType(file.name, outType), {
      type: outType,
      lastModified: Date.now(),
    })
  } catch {
    return file // fail-open: worst case we upload the original, as before
  }
}

/** Decode via createImageBitmap (EXIF-aware) with an <img> fallback. */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Older engines reject the options bag or the format — fall through.
    }
  }
  return await new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

/** Sparse alpha-channel scan (every 16th pixel) — cheap even at 1920px. */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, w, h).data
    for (let i = 3; i < data.length; i += 64) {
      if (data[i] < 255) return true
    }
    return false
  } catch {
    return true // can't inspect → assume transparency, PNG is the safe output
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

function renameForType(name: string, type: 'image/jpeg' | 'image/png'): string {
  const base = name.replace(/\.[^.]+$/, '') || 'image'
  return `${base}.${type === 'image/png' ? 'png' : 'jpg'}`
}
