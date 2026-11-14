import type { Course } from './types';

export function nextSessionDelay(courses: Course[], now: number): number | null {
  const boundaries = courses.flatMap(course => course.enrollment?.session ? [Date.parse(course.enrollment.session.starts_at), Date.parse(course.enrollment.session.ends_at)] : []).filter(time => time > now);
  return boundaries.length ? Math.min(Math.min(...boundaries) - now + 1, 2147483647) : null;
}
