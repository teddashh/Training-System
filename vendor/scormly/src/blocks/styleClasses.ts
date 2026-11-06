// Class names shared by the editor canvas and the learner preview for block
// styling. The SCORM player (public/scorm-player) builds the same class names
// and attributes, and player.css mirrors the rules from index.css.

import type { BlockBackground, BlockSettings, ImageSize, TextAlign } from '../types/course'

/** Backgrounds with light text on a dark/saturated fill. */
export const DARK_BACKGROUNDS: readonly BlockBackground[] = ['accent', 'gradient', 'dark', 'image']

export const BLOCK_BACKGROUNDS: readonly BlockBackground[] = [
  'none',
  'muted',
  'soft',
  'accent',
  'gradient',
  'dark',
  'image',
]

/** Inline background for a photo panel: the image under a dimming gradient
 *  (the player builds the same string). */
export function photoBackground(url: string): string {
  return `linear-gradient(rgb(10 12 20 / 0.55), rgb(10 12 20 / 0.62)), url("${url.replace(/"/g, '%22')}")`
}

/**
 * Wrapper attributes for a block: `blk` + padding class, plus `data-bg` when
 * the block has a background (neighbours with the same background are joined
 * into one panel by CSS).
 */
export function blockWrapperProps(
  settings: BlockSettings | undefined,
  /** Resolved URL of settings.backgroundImage (asset paths need resolving). */
  imageUrl?: string,
): {
  className: string
  'data-bg'?: BlockBackground
  style?: { backgroundImage: string }
} {
  const bg = settings?.background ?? 'none'
  const pad = settings?.spacing ?? 'normal'
  let className = `blk blk-pad-${pad}`
  const width = settings?.width ?? 'normal'
  if (width !== 'normal') className += ` blk-${width}`
  if (bg === 'none') return { className }
  className += ' blk-has-bg'
  if (DARK_BACKGROUNDS.includes(bg)) className += ' blk-on-dark'
  if (bg === 'image' && imageUrl) return { className, 'data-bg': bg, style: { backgroundImage: photoBackground(imageUrl) } }
  return { className, 'data-bg': bg }
}

/** Classes for a table: full width, or fitted to its content and placed. */
export function tableClass(width: 'full' | 'auto' = 'full', align: TextAlign = 'left') {
  return width === 'auto' ? `sc-table sc-table-auto sc-table-${align}` : 'sc-table'
}

/** Classes for a sized image figure. */
export function imageFigureClass(size: ImageSize = 'large', align: TextAlign = 'center') {
  return `sc-img sc-img-${size}${size === 'small' || size === 'medium' ? ` sc-img-${align}` : ''}`
}
