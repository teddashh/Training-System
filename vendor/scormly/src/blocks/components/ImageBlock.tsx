import type { BlockComponentProps } from '../types'
import type { BlockOfType, ImageSize, TextAlign } from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import {
  IMAGE_ACCEPT,
  Segmented,
  SettingsBar,
  UploadButton,
  useAssetUpload,
} from '../../components/editor/controls'
import { imageFigureClass } from '../styleClasses'

const IMAGE_SIZES: ImageSize[] = ['small', 'medium', 'large', 'full']

export default function ImageBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'image'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('media')
  const { t: td } = useT('design')
  const { src, alt, caption, decorative, size = 'large', align = 'center' } = block.data
  const displayUrl = useAssetUrl(src)
  const upload = useAssetUpload('image', (path) => update(lessonId, block.id, { src: path }))

  if (!src) {
    return (
      <div>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-white/60 px-6 py-12 text-gray-400 transition hover:border-brand hover:text-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-9 w-9" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="m21 16-5-5-9 9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-medium">{t('uploadImage')}</span>
          <input type="file" accept={IMAGE_ACCEPT} onChange={upload.onPick} className="sr-only" />
        </label>
        {upload.error && <p className="mt-2 text-sm text-red-600">{t('unsupportedImage')}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {selected && (
        <SettingsBar>
          <Segmented<ImageSize>
            label={td('imageSize')}
            value={size}
            onChange={(v) => update(lessonId, block.id, { size: v })}
            options={IMAGE_SIZES.map((s) => [s, td(`size_${s}`)] as const)}
          />
          {(size === 'small' || size === 'medium') && (
            <Segmented<TextAlign>
              label={td('imageAlign')}
              value={align}
              onChange={(v) => update(lessonId, block.id, { align: v })}
              options={(['left', 'center', 'right'] as const).map((a) => [a, td(`align_${a}`)] as const)}
            />
          )}
        </SettingsBar>
      )}

      <figure className={imageFigureClass(size, align)}>
        <img src={displayUrl || undefined} alt={decorative ? '' : alt} />
        <figcaption>
          <input
            type="text"
            value={caption ?? ''}
            placeholder={t('captionPlaceholder')}
            onChange={(e) =>
              update(lessonId, block.id, { caption: e.target.value }, `img-caption-${block.id}`)
            }
            className="w-full bg-transparent text-center placeholder-gray-300 outline-none"
          />
        </figcaption>
      </figure>

      {selected && (
        <div className="space-y-3 border-t border-gray-200 pt-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t('altLabel')}
            </span>
            <input
              type="text"
              value={alt}
              disabled={!!decorative}
              placeholder={t('altPlaceholder')}
              onChange={(e) =>
                update(lessonId, block.id, { alt: e.target.value }, `img-alt-${block.id}`)
              }
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
            />
          </label>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={!!decorative}
              onChange={(e) => update(lessonId, block.id, { decorative: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">{t('decorative')}</span>
              <span className="mt-0.5 block text-xs text-gray-500">{t('decorativeHelp')}</span>
            </span>
          </label>

          <UploadButton label={t('replaceImage')} accept={IMAGE_ACCEPT} onPick={upload.onPick} />
          {upload.error && <p className="text-sm text-red-600">{t('unsupportedImage')}</p>}
        </div>
      )}
    </div>
  )
}
