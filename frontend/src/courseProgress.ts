import type { Course } from "./types";

/** Badge and button of a personal course card. Both call a course started only while its measured progress is between 0 and 100. */
export function courseProgressLabels({ progress, progress_known }: Pick<Course, "progress" | "progress_known">) {
  const started = progress_known !== false && progress !== null && progress > 0 && progress < 100;
  return { status: started ? "In progress" : "Not started", action: started ? "Continue" : "Open" } as const;
}
