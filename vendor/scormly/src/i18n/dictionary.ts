import messages from '../../../../shared/locales/messages.json'
import type { Language } from './types'
import common from './locales/common'
import blocks from './locales/blocks'
import themes from './locales/themes'
import text from './locales/text'
import media from './locales/media'
import interactive from './locales/interactive'
import scenario from './locales/scenario'
import quiz from './locales/quiz'
import landing from './locales/landing'
import welcome from './locales/welcome'
import content from './locales/content'
import richtext from './locales/richtext'
import preview from './locales/preview'
import newblocks from './locales/newblocks'
import settings from './locales/settings'
import demo from './locales/demo'
import help from './locales/help'
import hotspotTimeline from './locales/hotspotTimeline'
import assessment from './locales/assessment'
import a11y from './locales/a11y'
import design from './locales/design'
import explainers from './locales/explainers'

// All translation namespaces. Each lives in its own file (src/i18n/locales/),
// so they can be worked on in parallel without conflicts.
const BASE_DICTIONARY = {
  common,
  blocks,
  themes,
  text,
  media,
  interactive,
  scenario,
  quiz,
  landing,
  welcome,
  content,
  richtext,
  preview,
  newblocks,
  settings,
  demo,
  help,
  hotspotTimeline,
  assessment,
  a11y,
  design,
  explainers,
}

export type Namespace = keyof typeof BASE_DICTIONARY

// Keep upstream namespaces and add the company platform's complete locales.
const catalog = messages as Record<string, Record<'en' | 'zh-TW' | 'es', string>>
export const DICTIONARY = Object.fromEntries(
  Object.entries(BASE_DICTIONARY).map(([namespace, table]) => [namespace, {
    uk: table.uk,
    ...Object.fromEntries((['en', 'zh-TW', 'es'] as const).map((locale) => [locale,
      Object.fromEntries(Object.entries(table.en).map(([key, value]) => [key, catalog[`studio.${namespace}.${key}`]?.[locale] ?? catalog[value]?.[locale] ?? value])),
    ])),
  }]),
) as Record<Namespace, Record<Language, Record<string, string>>>
