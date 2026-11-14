import type { Attempt } from "./types";
type Answers = Attempt["answers"];
export function sameAnswers(a: Answers, b: Answers): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => {
    if (!Object.hasOwn(b, key)) return false;
    const left = a[key], right = b[key];
    return Array.isArray(left) && Array.isArray(right)
      ? left.length === right.length && left.every((value, i) => value === right[i])
      : left === right;
  });
}
