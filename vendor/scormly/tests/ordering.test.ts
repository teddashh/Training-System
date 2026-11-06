// Ordering block scoring (src/blocks/ordering.ts).

import { describe, test, expect } from 'vitest'
import { scoreSequence, scoreCategories, shuffledOrder } from '../src/blocks/ordering'

const items = [
  { id: 'a', text: 'A', categoryId: 'x' },
  { id: 'b', text: 'B', categoryId: 'y' },
  { id: 'c', text: 'C', categoryId: 'x' },
]

describe('ordering scoring', () => {
  test('sequence: share of items at their authored position', () => {
    expect(scoreSequence(items, ['a', 'b', 'c'])).toBe(100)
    expect(scoreSequence(items, ['a', 'c', 'b'])).toBe(33)
    expect(scoreSequence(items, ['c', 'a', 'b'])).toBe(0)
    expect(scoreSequence([], [])).toBe(0)
  })

  test('categories: share of items in their category; unassigned are wrong', () => {
    expect(scoreCategories(items, { a: 'x', b: 'y', c: 'x' })).toBe(100)
    expect(scoreCategories(items, { a: 'x', b: 'x' })).toBe(33)
    // An item without a category can never be scored correct.
    expect(scoreCategories([{ id: 'z', text: 'Z' }], { z: undefined })).toBe(0)
  })

  test('shuffledOrder never returns the solved order for 2+ items', () => {
    const ids = ['a', 'b', 'c']
    // A "random" that leaves the array untouched forces the fallback rotation.
    const identity = shuffledOrder(ids, () => 0.9999)
    expect(identity).not.toEqual(ids)
    expect([...identity].sort()).toEqual(ids)
    expect(shuffledOrder(['only'])).toEqual(['only'])
    for (let i = 0; i < 20; i++) expect(shuffledOrder(ids)).not.toEqual(ids)
  })
})
