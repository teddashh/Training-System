import type { PreviewProps } from '../types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { imageFigureClass } from '../../blocks/styleClasses'

export default function ImagePreview({ block }: PreviewProps<'image'>) {
  const { src, alt, decorative, caption, size, align } = block.data
  const url = useAssetUrl(src)
  if (!src) return null
  return (
    <figure className={imageFigureClass(size, align)}>
      <img src={url || undefined} alt={decorative ? '' : alt} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
