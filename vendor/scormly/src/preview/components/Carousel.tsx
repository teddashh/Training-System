import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ImageRef } from '../../types/course'
import { useAssetUrl } from '../../hooks/useAssetUrl'
import { useT } from '../../i18n/I18nProvider'

// Image carousel (gallery layout 'carousel'): one slide at a time with a
// sliding track, prev/next buttons, dots, arrow keys and swipe. Mirrors
// renderCarousel() in the SCORM player.
export default function Carousel({ images }: { images: ImageRef[] }) {
  const { t } = useT('design')
  const [index, setIndex] = useState(0)
  const startX = useRef<number | null>(null)
  const total = images.length
  const current = Math.min(index, Math.max(0, total - 1))
  if (total === 0) return null

  const go = (n: number) => setIndex((n + total) % total)

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') go(current - 1)
    else if (e.key === 'ArrowRight') go(current + 1)
    else return
    e.preventDefault()
  }
  function onPointerUp(e: PointerEvent) {
    if (startX.current == null) return
    const dx = e.clientX - startX.current
    startX.current = null
    if (Math.abs(dx) > 40) go(current + (dx < 0 ? 1 : -1))
  }

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={t('carousel')}
      tabIndex={0}
      onKeyDown={onKey}
      className="sc-carousel"
    >
      <div
        className="sc-carousel-viewport"
        onPointerDown={(e) => (startX.current = e.clientX)}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (startX.current = null)}
      >
        <div className="sc-carousel-track" style={{ transform: `translateX(-${current * 100}%)` }}>
          {images.map((img, i) => (
            <Slide
              key={i}
              img={img}
              label={t('slideOf', { n: i + 1, total })}
              hidden={i !== current}
            />
          ))}
        </div>
        {total > 1 && (
          <>
            <button type="button" className="sc-carousel-btn sc-prev" aria-label={t('prevSlide')} onClick={() => go(current - 1)}>
              <Chevron dir="left" />
            </button>
            <button type="button" className="sc-carousel-btn sc-next" aria-label={t('nextSlide')} onClick={() => go(current + 1)}>
              <Chevron dir="right" />
            </button>
          </>
        )}
      </div>
      <div className="sc-carousel-foot">
        <p className="sc-carousel-caption" aria-live="polite">
          {images[current]?.caption || ''}
        </p>
        {total > 1 && (
          <div className="sc-carousel-dots">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={t('goToSlide', { n: i + 1 })}
                aria-current={i === current || undefined}
                className={i === current ? 'is-active' : ''}
                onClick={() => go(i)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Slide({ img, label, hidden }: { img: ImageRef; label: string; hidden: boolean }) {
  const url = useAssetUrl(img.src)
  return (
    <div
      className="sc-carousel-slide"
      role="group"
      aria-roledescription="slide"
      aria-label={label}
      aria-hidden={hidden || undefined}
    >
      <img src={url || undefined} alt={img.decorative ? '' : img.alt} draggable={false} />
    </div>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="h-5 w-5" aria-hidden>
      <path d={dir === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
