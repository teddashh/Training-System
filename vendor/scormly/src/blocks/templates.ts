// Ready-made blocks for the "+ Add block" menu: preconfigured blocks (style,
// layout, sample content) that insert as one undo step. A template may insert
// several blocks; neighbours with the same background render as one panel in
// the learner view. Labels live in i18n (`design` namespace: tpl_<id>,
// tpl_<id>Desc); sample content is localized at creation via `content`.

import type { Block, BlockBackground, BlockOfType, BlockType } from '../types/course'
import { createBlock } from './registry'
import { translate } from '../i18n/I18nProvider'

export type TemplateGroup = 'text' | 'quotes' | 'media' | 'structure'

export const TEMPLATE_GROUPS: TemplateGroup[] = ['text', 'quotes', 'media', 'structure']

export interface BlockTemplate {
  id: string
  group: TemplateGroup
  /** Block type whose icon represents the template. */
  icon: BlockType
  create: () => Block[]
}

const c = (key: string) => translate('content', key)

// createBlock with typed data/settings overrides.
function make<T extends BlockType>(
  type: T,
  data: Partial<BlockOfType<T>['data']>,
  background?: BlockBackground,
  spacing?: Block['settings']['spacing'],
  width?: Block['settings']['width'],
): Block {
  const block = createBlock(type) as BlockOfType<T>
  Object.assign(block.data, data)
  if (background) block.settings.background = background
  if (spacing) block.settings.spacing = spacing
  if (width) block.settings.width = width
  return block
}

const html = (...paras: string[]) => paras.map((p) => `<p>${p}</p>`).join('')

export const BLOCK_TEMPLATES: BlockTemplate[] = [
  // ── Text ──
  {
    id: 'headingText',
    group: 'text',
    icon: 'heading',
    create: () => [
      make('heading', { level: 2, text: c('tplHeadingTextTitle') }),
      make('paragraph', { html: html(c('tplHeadingTextBody')) }),
    ],
  },
  {
    id: 'lead',
    group: 'text',
    icon: 'paragraph',
    create: () => [make('paragraph', { variant: 'lead', html: html(c('tplLeadText')) })],
  },
  {
    id: 'dropcap',
    group: 'text',
    icon: 'paragraph',
    create: () => [make('paragraph', { variant: 'dropcap', html: html(c('tplDropcapText')) })],
  },
  {
    id: 'columns',
    group: 'text',
    icon: 'paragraph',
    create: () => [
      make('paragraph', { variant: 'columns', html: html(c('tplColumnsText1'), c('tplColumnsText2')) }),
    ],
  },
  {
    id: 'tip',
    group: 'text',
    icon: 'note',
    create: () => [make('note', { variant: 'tip', text: c('tplTipText') })],
  },
  {
    id: 'keyPoint',
    group: 'text',
    icon: 'note',
    create: () => [make('note', { variant: 'success', text: c('tplKeyPointText') })],
  },
  {
    id: 'statement',
    group: 'quotes',
    icon: 'quote',
    create: () => [
      make('quote', { variant: 'statement', text: c('tplStatement'), author: '' }, 'soft', 'spacious'),
    ],
  },
  {
    id: 'testimonial',
    group: 'quotes',
    icon: 'quote',
    create: () => [
      make(
        'quote',
        {
          variant: 'card',
          text: c('tplTestimonialText'),
          author: c('tplTestimonialAuthor'),
          role: c('tplTestimonialRole'),
        },
        'muted',
      ),
    ],
  },
  {
    id: 'quotePhotoLeft',
    group: 'quotes',
    icon: 'quote',
    create: () => [
      make('quote', {
        variant: 'photo',
        text: c('tplTestimonialText'),
        author: c('tplTestimonialAuthor'),
        role: c('tplTestimonialRole'),
      }),
    ],
  },
  {
    id: 'quotePhotoRight',
    group: 'quotes',
    icon: 'quote',
    create: () => [
      make('quote', {
        variant: 'photo',
        photoSide: 'right',
        text: c('tplTestimonialText'),
        author: c('tplTestimonialAuthor'),
        role: c('tplTestimonialRole'),
      }),
    ],
  },
  {
    id: 'quoteOnImage',
    group: 'quotes',
    icon: 'quote',
    create: () => [
      make('quote', {
        variant: 'image',
        text: c('tplQuoteOnImage'),
        author: c('tplQuoteOnImageAuthor'),
      }),
    ],
  },
  {
    id: 'carousel',
    group: 'media',
    icon: 'gallery',
    create: () => [make('gallery', { layout: 'carousel' })],
  },
  {
    id: 'imageText',
    group: 'media',
    icon: 'imageText',
    create: () => [make('imageText', { layout: 'left' })],
  },
  {
    id: 'textOnImage',
    group: 'media',
    icon: 'imageText',
    create: () => [
      make('imageText', { layout: 'overlay', html: `<p>${c('tplOverlayHtml')}</p>` }),
    ],
  },
  {
    id: 'hero',
    group: 'media',
    icon: 'imageText',
    create: () => [
      make('imageText', { layout: 'overlay', html: `<p>${c('tplOverlayHtml')}</p>` }, undefined, undefined, 'full'),
    ],
  },
  {
    id: 'wideCarousel',
    group: 'media',
    icon: 'gallery',
    create: () => [make('gallery', { layout: 'carousel' }, undefined, undefined, 'full')],
  },
  {
    id: 'fullImage',
    group: 'media',
    icon: 'image',
    create: () => [make('image', { size: 'full' })],
  },
  {
    id: 'banner',
    group: 'structure',
    icon: 'heading',
    create: () => [
      make('heading', { level: 2, text: c('tplBannerTitle'), align: 'center' }, 'gradient', 'spacious'),
    ],
  },
  {
    id: 'highlight',
    group: 'text',
    icon: 'paragraph',
    create: () => [
      make('heading', { level: 2, text: c('tplHighlightTitle') }, 'dark'),
      make('paragraph', { html: `<p>${c('tplHighlightText')}</p>` }, 'dark'),
    ],
  },
  {
    id: 'takeaways',
    group: 'text',
    icon: 'list',
    create: () => [
      make('heading', { level: 3, text: c('tplTakeawaysTitle') }, 'soft'),
      make(
        'list',
        { ordered: true, items: [c('tplTakeaway1'), c('tplTakeaway2'), c('tplTakeaway3')] },
        'soft',
      ),
    ],
  },
  {
    id: 'band',
    group: 'structure',
    icon: 'heading',
    create: () => [
      make('heading', { level: 2, text: c('tplBandTitle'), align: 'center' }, 'dark', 'normal', 'full'),
      make('paragraph', { html: html(c('tplBandText')) }, 'dark', 'normal', 'full'),
    ],
  },
  {
    id: 'photoBand',
    group: 'structure',
    icon: 'image',
    create: () => [
      make('paragraph', { variant: 'lead', html: html(`<strong>${c('tplBandTitle')}</strong>`, c('tplBandText')) }, 'image', 'spacious', 'full'),
    ],
  },
  {
    id: 'pictureBand',
    group: 'structure',
    icon: 'imageText',
    create: () => [make('imageText', { layout: 'right' }, 'soft', 'normal', 'full')],
  },
  {
    id: 'chapter',
    group: 'structure',
    icon: 'divider',
    create: () => [
      make('divider', { style: 'label', label: c('tplChapterLabel') }),
      make('heading', { level: 2, text: c('tplChapterTitle'), align: 'center' }),
    ],
  },
  {
    id: 'ornament',
    group: 'structure',
    icon: 'divider',
    create: () => [make('divider', { style: 'ornament' })],
  },
  {
    id: 'wave',
    group: 'structure',
    icon: 'divider',
    create: () => [make('divider', { style: 'wave' })],
  },
  {
    id: 'downloads',
    group: 'structure',
    icon: 'attachment',
    create: () => [make('attachment', {}, 'muted')],
  },
  {
    id: 'knowledgeCheck',
    group: 'structure',
    icon: 'quiz',
    create: () => [make('quiz', {}, 'muted')],
  },
]
