// Fill-in-the-blanks parser and scoring (src/blocks/fillBlanks.ts). The SCORM
// player mirrors this logic, so these cases double as its spec.

import { describe, test, expect } from 'vitest'
import {
  parseBlanks,
  blankAnswers,
  normalizeAnswer,
  isBlankCorrect,
  scoreBlanks,
  selectOptions,
} from '../src/blocks/fillBlanks'

describe('parseBlanks', () => {
  test('splits text and blanks, numbering blanks in order', () => {
    expect(parseBlanks('The capital of France is [Paris|paris]. [A] and [B].')).toEqual([
      { kind: 'text', text: 'The capital of France is ' },
      { kind: 'blank', index: 0, answers: ['Paris', 'paris'] },
      { kind: 'text', text: '. ' },
      { kind: 'blank', index: 1, answers: ['A'] },
      { kind: 'text', text: ' and ' },
      { kind: 'blank', index: 2, answers: ['B'] },
      { kind: 'text', text: '.' },
    ])
  })

  test('trims alternatives and drops empty ones; first stays canonical', () => {
    expect(blankAnswers('x [ one | | two ] y')).toEqual([['one', 'two']])
  })

  test('empty brackets and unclosed brackets stay literal', () => {
    expect(parseBlanks('a [] b [ | ] c [open')).toEqual([{ kind: 'text', text: 'a [] b [ | ] c [open' }])
    expect(blankAnswers('no blanks here')).toEqual([])
    expect(parseBlanks('')).toEqual([])
  })

  test('blanks at the edges and adjacent blanks', () => {
    expect(parseBlanks('[a][b]')).toEqual([
      { kind: 'blank', index: 0, answers: ['a'] },
      { kind: 'blank', index: 1, answers: ['b'] },
    ])
  })

  test('nested or multi-line brackets do not form a blank', () => {
    expect(blankAnswers('[[x]]')).toEqual([['x']])
    expect(blankAnswers('[a\nb]')).toEqual([])
  })
})

describe('answer checking', () => {
  test('normalizes whitespace and case', () => {
    expect(normalizeAnswer('  New   York ')).toBe('new york')
    expect(normalizeAnswer(' New York', true)).toBe('New York')
  })

  test('accepts any alternative; case-insensitive by default', () => {
    expect(isBlankCorrect(['Paris', 'Paname'], 'paris')).toBe(true)
    expect(isBlankCorrect(['Paris', 'Paname'], ' paname ')).toBe(true)
    expect(isBlankCorrect(['Paris'], 'paris', true)).toBe(false)
    expect(isBlankCorrect(['Paris'], '')).toBe(false)
    expect(isBlankCorrect(['Paris'], undefined)).toBe(false)
  })

  test('scoreBlanks is the rounded percentage of correct blanks', () => {
    const blanks = blankAnswers('[a] [b] [c]')
    expect(scoreBlanks(blanks, ['a', 'B', 'x'])).toBe(67)
    expect(scoreBlanks(blanks, ['a', 'B', 'x'], true)).toBe(33)
    expect(scoreBlanks(blanks, [])).toBe(0)
    expect(scoreBlanks([], [])).toBe(0)
  })

  test('select options are the de-duplicated canonical answers', () => {
    expect(selectOptions(blankAnswers('[x|y] [z] [x]'))).toEqual(['x', 'z'])
  })
})
