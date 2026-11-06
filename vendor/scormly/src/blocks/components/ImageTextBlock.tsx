import type { BlockComponentProps } from '../types'
import type { BlockOfType, ImageTextLayout } from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import RichTextEditor from '../../components/editor/RichTextEditor'
import {
  IMAGE_ACCEPT,
  Segmented,
  SettingsBar,
  UploadButton,
  useAssetUpload,
} from '../../components/editor/controls'

const LAYOUTS: ImageTextLayout[] = ['left', 'right', 'overlay']

// Image beside the text (left/right) or text over the image (overlay).
// Same markup/classes as ImageTextPreview and the player's renderImageText.
export default function ImageTextBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'imageText'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('media')
  const { t: tt } = useT('text')
  const { t: td } = useT('design')
  const { src, alt, decorative, layout, html } = block.data
  const url = useAssetUrl(src)
  const upload = useAssetUpload('image', (path) => update(lessonId, block.id, { src: path }))

  return (
    <div className="space-y-3">
      {selected && (
        <SettingsBar>
          <Segmented<ImageTextLayout>
            label={td('imageTextLayout')}
            value={layout}
            onChange={(v) => update(lessonId, block.id, { layout: v })}
            options={LAYOUTS.map((l) => [l, td(`layout_${l}`)] as const)}
          />
          {src && (
            <UploadButton variant="subtle" label={t('replaceImage')} accept={IMAGE_ACCEPT} onPick={upload.onPick} />
          )}
        </SettingsBar>
      )}

      <div className={`sc-imgtext sc-imgtext-${layout}${src ? '' : ' no-image'}`}>
        <div className="sc-imgtext-media">
          {src ? (
            <img src={url || undefined} alt={decorative ? '' : alt} />
          ) : (
            <label className="flex h-full min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-[inherit] border-2 border-dashed border-gray-300 bg-white/70 text-gray-400 transition hover:border-brand hover:text-brand">
              <span className="text-sm font-medium">{t('uploadImage')}</span>
              <input type="file" accept={IMAGE_ACCEPT} onChange={upload.onPick} className="sr-only" />
            </label>
          )}
        </div>
        <div className="sc-imgtext-body">
          <RichTextEditor
            html={html}
            placeholder={tt('paragraphPlaceholder')}
            onChange={(next) => update(lessonId, block.id, { html: next }, `imgtext-html-${block.id}`)}
          />
        </div>
      </div>
      {upload.error && <p className="text-sm text-red-600">{t('unsupportedImage')}</p>}

      {selected && src && (
        <div className="flex flex-wrap items-center gap-4 border-t border-gray-200 pt-3">
          <input
            type="text"
            value={alt}
            disabled={!!decorative}
            aria-label={t('altLabel')}
            placeholder={t('altPlaceholder')}
            onChange={(e) => update(lessonId, block.id, { alt: e.target.value }, `imgtext-alt-${block.id}`)}
            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
          />
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={!!decorative}
              onChange={(e) => update(lessonId, block.id, { decorative: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            {t('decorative')}
          </label>
        </div>
      )}
    </div>
  )
}
