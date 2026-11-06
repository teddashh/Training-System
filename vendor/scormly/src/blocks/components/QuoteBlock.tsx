import type { BlockComponentProps } from '../types'
import type { BlockOfType, QuoteVariant } from '../../types/course'
import { useCourseStore } from '../../store/courseStore'
import { useT } from '../../i18n/I18nProvider'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import {
  AutoTextarea,
  IMAGE_ACCEPT,
  Segmented,
  SettingsBar,
  UploadButton,
  useAssetUpload,
} from '../../components/editor/controls'

const QUOTE_VARIANTS: QuoteVariant[] = ['classic', 'statement', 'card', 'photo', 'image']

// WYSIWYG quote editor: the same markup/classes as the learner view
// (QuotePreview, player renderQuote) with inputs in place of the text.
export default function QuoteBlock({
  block,
  lessonId,
  selected,
}: BlockComponentProps<BlockOfType<'quote'>>) {
  const update = useCourseStore((s) => s.updateBlockData)
  const { t } = useT('newblocks')
  const { t: td } = useT('design')
  const { text, author, role, image, variant = 'classic', photoSide = 'left' } = block.data
  const imageUrl = useAssetUrl(image ?? '')
  const upload = useAssetUpload('image', (path) => update(lessonId, block.id, { image: path }))
    const usesImage = variant === 'card' || variant === 'photo' || variant === 'image'
  const hasMedia = (variant === 'photo' || variant === 'image') && !!image

  return (
    <div className="space-y-3">
      {selected && (
        <SettingsBar>
          <Segmented<QuoteVariant>
            label={td('quoteStyle')}
            value={variant}
            onChange={(v) => update(lessonId, block.id, { variant: v })}
            options={QUOTE_VARIANTS.map((v) => [v, td(`quote_${v}`)] as const)}
          />
          {variant === 'photo' && (
            <Segmented<'left' | 'right'>
              label={td('photoSide')}
              value={photoSide}
              onChange={(v) => update(lessonId, block.id, { photoSide: v })}
              options={[
                ['left', td('align_left')],
                ['right', td('align_right')],
              ]}
            />
          )}
          {usesImage && (
            <span className="flex items-center gap-1">
              <UploadButton
                variant="subtle"
                label={image ? td(variant === 'image' ? 'replaceBackground' : 'replacePhoto') : td(variant === 'image' ? 'uploadBackground' : 'uploadPhoto')}
                accept={IMAGE_ACCEPT}
                onPick={upload.onPick}
              />
              {image && (
                <button
                  type="button"
                  onClick={() => update(lessonId, block.id, { image: '' })}
                  className="rounded-md px-2.5 py-1 text-sm font-medium text-gray-500 hover:bg-red-50 hover:text-red-600"
                >
                  {td('removeImage')}
                </button>
              )}
            </span>
          )}
          {upload.error && <span className="text-sm text-red-600">{td('unsupportedImage')}</span>}
        </SettingsBar>
      )}

      <figure className={`sc-quote sc-quote-${variant}${hasMedia ? ' has-media' : ''}${variant === 'photo' && photoSide === 'right' ? ' photo-right' : ''}`}>
        {variant === 'photo' && image && (
          <div className="sc-quote-media">
            <img src={imageUrl || undefined} alt="" />
          </div>
        )}
        {variant === 'image' && image && <img className="sc-quote-bg" src={imageUrl || undefined} alt="" />}
        <div className="sc-quote-body">
          {variant !== 'classic' && <span className="sc-quote-mark" aria-hidden>“</span>}
          <blockquote className="sc-quote-text">
            <AutoTextarea
              value={text}
              placeholder={t('quotePlaceholder')}
              onChange={(e) =>
                update(lessonId, block.id, { text: e.target.value }, `quote-${block.id}`)
              }
              className="w-full bg-transparent outline-none placeholder:text-current placeholder:opacity-40"
              style={{ textAlign: 'inherit' }}
            />
          </blockquote>
          {(selected || author || role) && (
          <figcaption className="sc-quote-cite">
            {variant === 'card' && image && <img className="sc-quote-avatar" src={imageUrl || undefined} alt="" />}
            <span className="sc-quote-who">
              <input
                type="text"
                value={author ?? ''}
                placeholder={t('authorPlaceholder')}
                onChange={(e) =>
                  update(lessonId, block.id, { author: e.target.value }, `quote-author-${block.id}`)
                }
                className="sc-quote-author w-full bg-transparent outline-none placeholder:text-current placeholder:opacity-40"
                style={{ textAlign: 'inherit' }}
              />
              {((selected && author) || role) && (
                <input
                  type="text"
                  value={role ?? ''}
                  placeholder={td('rolePlaceholder')}
                  onChange={(e) =>
                    update(lessonId, block.id, { role: e.target.value }, `quote-role-${block.id}`)
                  }
                  className="sc-quote-role w-full bg-transparent outline-none placeholder:text-current placeholder:opacity-40"
                  style={{ textAlign: 'inherit' }}
                />
              )}
            </span>
          </figcaption>
          )}
        </div>
      </figure>
    </div>
  )
}
