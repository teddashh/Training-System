import { api } from './api';
import type { Course, Enrollment } from './types';

export type RegistrationReturn = {
  kind: 'course' | 'exam'; id: string; register: boolean;
  choice: boolean; session: number | null; time: number;
};

// Accept both historical shapes; whitelist identifiers, never a URL or capability.
export function parseRegistrationReturn(raw: string | null, now = Date.now()): RegistrationReturn | null {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || typeof value.id !== 'string' || !/^[1-9]\d*$/.test(value.id)
        || !Number.isSafeInteger(Number(value.id)) || typeof value.time !== 'number'
        || !Number.isFinite(value.time) || now < value.time || now - value.time >= 1800000) return null;
    const kind = value.kind === undefined ? 'course' : value.kind;
    if (kind !== 'course' && kind !== 'exam') return null;
    const choice = kind === 'course' && value.choice === true;
    if (choice && value.session !== null && (!Number.isSafeInteger(value.session) || value.session < 1)) return null;
    return {kind, id: value.id, register: value.kind === undefined || value.register === true,
      choice, session: choice ? value.session : null, time: value.time};
  } catch { return null; }
}

export function storeRegistrationChoice(course: number, session: number | null) {
  sessionStorage.setItem('training-registration', JSON.stringify({
    kind: 'course', id: String(course), choice: true, session, time: Date.now(),
  }));
}

export async function completeRegistration(courseId: number, session: number | null): Promise<string> {
  const course = await api<Course>(`courses/${courseId}/`);
  const before = course.enrollment;
  const row = await api<Enrollment>(`courses/${courseId}/enroll/`, 'POST', {
    session, revision: before?.revision || 0,
  });
  if (before && ['approved', 'pending'].includes(before.status) && before.id === row.id && before.revision === row.revision)
    return row.status === 'pending' ? 'Waiting for approval' : "You're registered";
  return row.status === 'pending' ? 'Waiting for approval' : "You're registered";
}
