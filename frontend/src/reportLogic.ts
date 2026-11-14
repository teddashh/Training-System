export function roundedPercent(value: number) { return Math.round(value * 10) / 10; }
export function audiencePadding(employees: number, contractors: number) { return employees > 0 && contractors > 0 ? 5 : 0; }
export function gradePayload(marks: Record<string, {points: string; feedback: string}>) {
  return Object.fromEntries(Object.entries(marks).map(([key, mark]) => {
    if (!mark.points.trim() || !Number.isFinite(Number(mark.points))) throw new Error('A numeric score is required');
    return [key, {...mark, points: Number(mark.points)}];
  }));
}
