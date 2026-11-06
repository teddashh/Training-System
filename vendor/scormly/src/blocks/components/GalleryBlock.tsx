import type { BlockComponentProps } from '../types'
import type { BlockOfType, GalleryLayout, ImageRef } from '../../types/course'
import { useCourseStore, blocksOf } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import {
  IMAGE_ACCEPT,
  Segmented,
  SettingsBar,
  useAssetUpload,
} from '../../components/editor/controls'
import Carousel from '../../preview/components/Carousel'

export default function GalleryBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'gallery'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('media')
  const { t: td } = useT('design')
  const { images, layout = 'grid', columns = 3 } = block.data
  const carousel = layout === 'carousel'

  // Uploads of a multi-file pick resolve one by one; read the latest images
  // from the store each time so earlier ones aren't overwritten.
  const upload = useAssetUpload('image', (src) => {
    const current = blocksOf(useCourseStore.getState().course, lessonId)?.find((b) => b.id === block.id)
    const list = current?.type === 'gallery' ? current.data.images : images
    update(lessonId, block.id, { images: [...list, { src, alt: '' }] })
  })

  function patchAt(index: number, patch: Partial<ImageRef>, coalesceKey?: string) {
    update(
      lessonId,
      block.id,
      { images: images.map((img, i) => (i === index ? { ...img, ...patch } : img)) },
      coalesceKey,
    )
  }

  function removeAt(index: number) {
    update(lessonId, block.id, { images: images.filter((_, i) => i !== index) })
  }

  function moveAt(index: number, dir: -1 | 1) {
    const to = index + dir
    if (to < 0 || to >= images.length) return
    const next = [...images]
    ;[next[index], next[to]] = [next[to], next[index]]
    update(lessonId, block.id, { images: next })
  }

  const addButton = (
    <label className="flex cursor-pointer items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 bg-white/60 px-6 py-10 text-sm font-medium text-gray-400 transition hover:border-brand hover:text-brand">
      + {t('addImages')}
      <input type="file" accept={IMAGE_ACCEPT} multiple onChange={upload.onPick} className="sr-only" />
    </label>
  )
  const error = upload.error && <p className="mt-2 text-sm text-red-600">{t('unsupportedImage')}</p>

  const settings = selected && (
    <SettingsBar>
      <Segmented<GalleryLayout>
        label={td('galleryLayout')}
        value={layout}
        onChange={(v) => update(lessonId, block.id, { layout: v })}
        options={[
          ['grid', td('layout_grid')],
          ['carousel', td('layout_carousel')],
        ]}
      />
      {!carousel && (
        <Segmented<2 | 3 | 4>
          label={td('columns')}
          value={columns}
          onChange={(v) => update(lessonId, block.id, { columns: v })}
          options={[
            [2, '2'],
            [3, '3'],
            [4, '4'],
          ]}
        />
      )}
    </SettingsBar>
  )

  if (images.length === 0) {
    return (
      <div className="space-y-3">
        {settings}
        {addButton}
        {error}
      </div>
    )
  }

  // Not being edited: show exactly what the learner sees.
  if (!selected && carousel) return <Carousel images={images} />

  return (
    <div className="space-y-3">
      {settings}
      <div className={`grid gap-3 ${selected || columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : columns === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {images.map((img, i) => (
          <div key={i}>
            <div className="group relative">
              <GalleryThumb src={img.src} alt={img.decorative ? '' : img.alt} />
              {selected && (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                  <ThumbButton label={td('moveLeft')} disabled={i === 0} onClick={() => moveAt(i, -1)}>
                    ←
                  </ThumbButton>
                  <ThumbButton label={td('moveRight')} disabled={i === images.length - 1} onClick={() => moveAt(i, 1)}>
                    →
                  </ThumbButton>
                  <ThumbButton label={t('removeImage')} onClick={() => removeAt(i)}>
                    ✕
                  </ThumbButton>
                </div>
              )}
            </div>
            {selected ? (
              <div className="mt-1.5 space-y-1">
                <input
                  type="text"
                  value={img.caption ?? ''}
                  aria-label={td('imageCaption', { n: i + 1 })}
                  placeholder={t('captionPlaceholder')}
                  onChange={(e) =>
                    patchAt(i, { caption: e.target.value }, `gallery-caption-${block.id}-${i}`)
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-brand"
                />
                <input
                  type="text"
                  value={img.alt}
                  disabled={!!img.decorative}
                  aria-label={t('imageAlt', { n: i + 1 })}
                  placeholder={t('altLabel')}
                  onChange={(e) =>
                    patchAt(i, { alt: e.target.value }, `gallery-alt-${block.id}-${i}`)
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                />
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={!!img.decorative}
                    onChange={(e) => patchAt(i, { decorative: e.target.checked })}
                    className="h-3.5 w-3.5 accent-brand"
                  />
                  {t('decorative')}
                </label>
              </div>
            ) : (
              img.caption && <p className="mt-1.5 text-center text-xs text-gray-500">{img.caption}</p>
            )}
          </div>
        ))}
      </div>
      {selected && addButton}
      {error}
    </div>
  )
}

function ThumbButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-sm text-white backdrop-blur hover:bg-black/80 disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function GalleryThumb({ src, alt }: { src: string; alt: string }) {
  const url = useAssetUrl(src)
  return (
    <img src={url || undefined} alt={alt} className="aspect-square w-full rounded-lg object-cover" />
  )
}
