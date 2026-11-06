// Quiz question types and their starting content, shared by the quiz editor
// and its "Add question" menu (whose hover preview shows the same seed).

import type { ChoiceOption, MatchingPair, Question, QuestionType, SequenceItem } from '../types/course'
import { uid } from '../lib/id'
import { translate } from '../i18n/I18nProvider'

export const QUESTION_TYPES: QuestionType[] = ['single', 'multiple', 'matching', 'sequence', 'fillBlanks']

/** i18n keys (quiz namespace) of each type's name; `${key}Desc` describes it. */
export const TYPE_LABEL_KEYS: Record<QuestionType, string> = {
  single: 'typeSingle',
  multiple: 'typeMultiple',
  matching: 'typeMatching',
  sequence: 'typeSequence',
  fillBlanks: 'typeFillBlanks',
}

export function newOption(correct = false): ChoiceOption {
  return {
    id: uid('opt'),
    text: translate('content', correct ? 'quizCorrect' : 'quizWrong'),
    correct,
  }
}

/** An empty pair, or a numbered "Term n ↔ Definition n" seed. */
export function newPair(n?: number): MatchingPair {
  if (n == null) return { id: uid('pair'), left: '', right: '' }
  return {
    id: uid('pair'),
    left: `${translate('content', 'cardFront')} ${n}`,
    right: `${translate('content', 'cardBack')} ${n}`,
  }
}

export function newItem(n: number): SequenceItem {
  return { id: uid('item'), text: translate('content', 'orderingItem', { n }) }
}

export function newQuestion(type: QuestionType): Question {
  const base = { id: uid('q'), prompt: translate('content', 'quizPrompt') }
  switch (type) {
    case 'single':
      return { ...base, type, options: [newOption(true), newOption()] }
    case 'multiple':
      return { ...base, type, options: [newOption(true), newOption(true), newOption()] }
    case 'matching':
      return { ...base, type, pairs: [newPair(1), newPair(2)] }
    case 'sequence':
      return { ...base, type, items: [newItem(1), newItem(2), newItem(3)] }
    case 'fillBlanks':
      return { ...base, type, mode: 'type', text: translate('content', 'fillBlanksText') }
  }
}
