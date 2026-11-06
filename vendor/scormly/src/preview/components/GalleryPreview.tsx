import type { PreviewProps } from '../types'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import Carousel from './Carousel'

export default function GalleryPreview({ block }: PreviewProps<'gallery'>) {
  const { images, layout = 'grid', columns = 3 } = block.data
  if (layout === 'carousel') return <Carousel images={images} />
  return (
    <div className={`sc-gallery sc-cols-${columns}`}>
      {images.map((img, i) => (
        <GalleryImage key={i} src={img.src} alt={img.decorative ? '' : img.alt} caption={img.caption} />
      ))}
    </div>
  )
}

function GalleryImage({ src, alt, caption }: { src: string; alt: string; caption?: string }) {
  const url = useAssetUrl(src)
  return (
    <figure>
      <img src={url || undefined} alt={alt} />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}
