import type { PreviewProps } from '../types'
import { useAssetUrl } from '../../hooks/useAssetUrl'

// Learner view of a quote; the markup is shared with the editor (QuoteBlock)
// and the SCORM player (renderQuote), styled by the sc-quote-* classes.
export default function QuotePreview({ block }: PreviewProps<'quote'>) {
  const { text, author, role, image, variant = 'classic', photoSide = 'left' } = block.data
  const url = useAssetUrl(image ?? '')
  const hasMedia = (variant === 'photo' || variant === 'image') && !!image
  return (
    <figure className={`sc-quote sc-quote-${variant}${hasMedia ? ' has-media' : ''}${variant === 'photo' && photoSide === 'right' ? ' photo-right' : ''}`}>
      {variant === 'photo' && image && (
        <div className="sc-quote-media">
          <img src={url || undefined} alt="" />
        </div>
      )}
      {variant === 'image' && image && <img className="sc-quote-bg" src={url || undefined} alt="" />}
      <div className="sc-quote-body">
        {variant !== 'classic' && <span className="sc-quote-mark" aria-hidden>“</span>}
        <blockquote className="sc-quote-text">{text}</blockquote>
        {(author || role) && (
          <figcaption className="sc-quote-cite">
            {variant === 'card' && image && <img className="sc-quote-avatar" src={url || undefined} alt="" />}
            <span className="sc-quote-who">
              {author && <span className="sc-quote-author">{author}</span>}
              {role && <span className="sc-quote-role">{role}</span>}
            </span>
          </figcaption>
        )}
      </div>
    </figure>
  )
}
