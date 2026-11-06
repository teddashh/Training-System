// Pure scoring helpers for the ordering ("Sort / order") block. The SCORM
// player (public/scorm-player/player.js) mirrors this logic in vanilla JS.

import type { OrderingItem } from '../types/course'

/** Sequence mode: percentage (0–100, rounded) of items placed at their
 *  authored position. `order` is the learner's order of item ids. */
export function scoreSequence(items: OrderingItem[], order: string[]): number {
  if (!items.length) return 0
  const ok = items.filter((it, i) => order[i] === it.id).length
  return Math.round((ok / items.length) * 100)
}

/** Categories mode: percentage (0–100, rounded) of items put into their
 *  category. `assigned` maps item id → chosen category id. */
export function scoreCategories(
  items: OrderingItem[],
  assigned: Record<string, string | undefined>,
): number {
  if (!items.length) return 0
  const ok = items.filter((it) => !!it.categoryId && assigned[it.id] === it.categoryId).length
  return Math.round((ok / items.length) * 100)
}

/** Shuffle item ids for the learner, never returning the solved order when
 *  there are at least two items (a free full score would be pointless). */
export function shuffledOrder(ids: string[], random: () => number = Math.random): string[] {
  const out = ids.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  if (out.length > 1 && out.every((id, i) => id === ids[i])) out.push(out.shift()!)
  return out
}
