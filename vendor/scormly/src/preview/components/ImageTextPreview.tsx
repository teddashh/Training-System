import type { PreviewProps } from '../types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import RichHtml from '../RichHtml'

export default function ImageTextPreview({ block }: PreviewProps<'imageText'>) {
  const { src, alt, decorative, layout, html } = block.data
  const url = useAssetUrl(src)
  return (
    <div className={`sc-imgtext sc-imgtext-${layout}${src ? '' : ' no-image'}`}>
      {src && (
        <div className="sc-imgtext-media">
          <img src={url || undefined} alt={decorative ? '' : alt} />
        </div>
      )}
      <RichHtml html={html} className="sc-imgtext-body rich-text" />
    </div>
  )
}
