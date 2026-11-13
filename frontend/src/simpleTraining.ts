import type { Course, CourseSession, Enrollment } from './types';

export type RosterInput = { text: string; people: number[]; groups: number[] };
export type RosterRow = { input: string; outcome: string; user?: number | null; name?: string; email?: string; department?: string };
export type RosterReport = { session?: number; counts: Record<string, number>; rows: RosterRow[]; notified?: number };
export type TrainingReceipt = { course: number; registration_url: string | null; sessions: number[]; rosters?: RosterReport[]; roster?: RosterReport | null; quiz: unknown };
export type SessionDraft = { key: string; date: string; start: string; end: string; location: string; capacity: string; ownLocation: boolean; ownCapacity: boolean; roster: RosterInput };
/** `gated` false: a published quiz already open to its own audience; missing counts as gated. */
export type QuizOption = { id: number; title: string; published: boolean; question_count: number; gated?: boolean; audience?: string };
export type MailEvent = { kind: string; exam: number | null; scheduled_at: string | null; produced_at: string | null; state: 'scheduled' | 'disabled' | 'produced' | 'superseded'; delivery: Record<string, number> };
export type SessionOverview = CourseSession & { counts: { registered: number; pending: number; present: number; absent: number; seats: number }; emails: MailEvent[] };
export type QuizOverview = QuizOption & { release: 'immediate' | 'after_session'; participation: { started: number; passed: number } };
export type TrainingOverview = { id: number; title: string; published: boolean; release_at: string | null; reminders: boolean; registration_url: string | null; sessions: SessionOverview[]; quizzes: QuizOverview[]; people: number };
export type EnrollmentRow = Enrollment & { user_id: number; person: string; username: string; department: string; active: boolean; reviewer?: string; quiz: 'passed' | 'not_passed' | 'not_started' | null };
export type EnrollmentPage = { count: number; page: number; page_size: number; counts: Record<string, number>; results: EnrollmentRow[] };

export const MAX_SESSIONS = 10;
export const gated = (quiz?: Pick<QuizOption, 'gated'> | null) => quiz?.gated !== false;
/** People a mail was queued for (0 while the course is unreleased or mail is off). */
export const notifiedCount = (reports: (RosterReport | null | undefined)[]) => reports.reduce((sum, report) => sum + (report?.notified || 0), 0);
/** Released: published and its release time, if any, has passed. */
export const released = (course: { published: boolean; release_at: string | null }, now = Date.now()) => course.published && !(course.release_at && Date.parse(course.release_at) > now);
/** Outcomes that leave the person registered; everything else is listed as skipped. */
const ACCEPTED = ['added', 'approved', 'already', 'moved'];
/** Two-word reasons for lines that were not registered. */
export const REASONS: Record<string, string> = {
  not_found: 'Not found', ambiguous: 'Several matches', inactive: 'Inactive', not_checked: 'Not checked',
  duplicate: 'Listed twice', full: 'No seats left',
};

export const emptyRoster = (): RosterInput => ({ text: '', people: [], groups: [] });
export const newSession = (first?: SessionDraft): SessionDraft => ({
  key: crypto.randomUUID(), date: '', start: '', end: '', location: first?.location || '',
  capacity: first?.capacity || '30', ownLocation: false, ownCapacity: false, roster: emptyRoster(),
});
export const hasPeople = (roster: RosterInput) => !!(roster.text.trim() || roster.people.length || roster.groups.length);
export const accepted = (report?: RosterReport | null) => report?.rows.filter(row => ACCEPTED.includes(row.outcome)).length || 0;
export const skipped = (report?: RosterReport | null) => report?.rows.filter(row => !ACCEPTED.includes(row.outcome)) || [];
/** Equal inputs share one check result; any edit hides the old result until the next check. */
export const rosterSignature = (roster: RosterInput) => JSON.stringify([roster.text.trim(), [...roster.people].sort(), [...roster.groups].sort()]);
/** Lines read from an uploaded file join the text box, so there is one representation. */
export function appendLines(text: string, lines: string[]) {
  // A line that is already in the box (or twice in the file) is not repeated.
  const seen = new Set(text.split('\n').map(line => line.trim().toLowerCase()).filter(Boolean));
  const added = lines.map(line => line.trim()).filter(line => line && !seen.has(line.toLowerCase()) && !!seen.add(line.toLowerCase()));
  return [text.trimEnd(), ...added].filter(Boolean).join('\n');
}

/** Later sessions follow the first session's place and seats until edited themselves. */
export function updateSession(sessions: SessionDraft[], index: number, patch: Partial<SessionDraft>) {
  return sessions.map((session, i) => {
    if (i === index) return {
      ...session, ...patch,
      ...(i > 0 && 'location' in patch ? { ownLocation: true } : {}),
      ...(i > 0 && 'capacity' in patch ? { ownCapacity: true } : {}),
    };
    if (index !== 0) return session;
    return {
      ...session,
      ...('location' in patch && !session.ownLocation ? { location: patch.location } : {}),
      ...('capacity' in patch && !session.ownCapacity ? { capacity: patch.capacity } : {}),
    };
  });
}

const pad = (value: number) => String(value).padStart(2, '0');
export const localDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** Dates and times are read in the browser's time zone, as in the session editor. */
const instant = (date: string, time: string) => new Date(`${date}T${time}`);

/** Field keys match the server's (`sessions[1].ends_at`) so both kinds of message share a place. */
export function validateTraining(title: string, sessions: SessionDraft[], now = new Date()) {
  const errors: Record<string, string> = {};
  const today = localDay(now);
  if (!title.trim()) errors.title = 'Enter a title.';
  sessions.forEach((session, i) => {
    const prefix = `sessions[${i}].`;
    // A later block left empty is not created; one that already has times or people needs its date.
    if (!session.date) { if (i === 0 || session.start || session.end || hasPeople(session.roster)) errors[prefix + 'date'] = 'Choose a date.'; return; }
    if (session.date < today) errors[prefix + 'date'] = 'Choose today or later.';
    if (!session.start) errors[prefix + 'starts_at'] = 'Enter a start time.';
    else if (session.date === today && instant(session.date, session.start) <= now) errors[prefix + 'starts_at'] = 'Choose a later time.';
    if (!session.end) errors[prefix + 'ends_at'] = 'Enter an end time.';
    else if (session.start && session.end <= session.start) errors[prefix + 'ends_at'] = 'End after the start.';
    if (!session.location.trim()) errors[prefix + 'location'] = 'Enter a place.';
    if (!/^\d+$/.test(session.capacity) || +session.capacity < 1 || +session.capacity > 10000) errors[prefix + 'capacity'] = 'Enter 1–10,000 seats.';
  });
  return errors;
}

/** Form positions of the sessions that will be created (blocks without a date are dropped). */
export const datedIndexes = (sessions: SessionDraft[]) => sessions.flatMap((s, i) => s.date ? [i] : []);

export function trainingPayload({ requestId, title, description, cover, sessions, exam }: {
  requestId: string; title: string; description: string; cover: string; sessions: SessionDraft[]; exam: number | null;
}) {
  const dated = datedIndexes(sessions).map(i => sessions[i]);
  return {
    request_id: requestId, title: title.trim(), description: description.trim(), cover,
    sessions: dated.map(s => ({
      title: '', starts_at: instant(s.date, s.start).toISOString(), ends_at: instant(s.date, s.end).toISOString(),
      location: s.location.trim(), capacity: +s.capacity,
    })),
    rosters: dated.flatMap((s, session) => hasPeople(s.roster) ? [{ session, ...s.roster, text: s.roster.text.trim() }] : []),
    ...(exam ? { exam } : {}),
    notify: true,
  };
}

/** Maps server keys (indexes of created sessions / sent rosters) back to the fields of the form. */
export function formErrors(body: unknown, sessions: SessionDraft[]) {
  const errors: Record<string, string> = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return errors;
  const dated = datedIndexes(sessions);
  const rosterOwners = dated.filter(i => hasPeople(sessions[i].roster));
  const text = (value: unknown): string => Array.isArray(value) ? value.map(text).filter(Boolean).join(' ') : typeof value === 'string' ? value : value && typeof value === 'object' ? Object.values(value).map(text).join(' ') : '';
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === 'code' || key === 'detail' && typeof value !== 'string') continue;
    const message = text(value);
    if (!message) continue;
    const session = /^sessions\[(\d+)\]\.(\w+)/.exec(key);
    const roster = /^rosters\[(\d+)\]/.exec(key);
    let field = 'general';
    if (key === 'title' || key === 'exam') field = key;
    else if (session && dated[+session[1]] !== undefined) {
      const name = ['starts_at', 'ends_at', 'location', 'capacity'].includes(session[2]) ? session[2] : 'date';
      field = `sessions[${dated[+session[1]]}].${name}`;
    } else if (roster && rosterOwners[+roster[1]] !== undefined) field = `people[${rosterOwners[+roster[1]]}]`;
    else if (key.startsWith('roster') && rosterOwners.length) field = `people[${rosterOwners[0]}]`;
    errors[field] = errors[field] ? `${errors[field]} ${message}` : message;
  }
  return errors;
}

/** Rosters in the creation receipt, by form position of the session they belong to. */
export function receiptReports(receipt: TrainingReceipt) {
  return receipt.rosters || (receipt.roster ? [receipt.roster] : []);
}

export function nextSession(course: Pick<Course, 'sessions'>, now = Date.now()) {
  return course.sessions.filter(s => !s.cancelled && Date.parse(s.starts_at) >= now).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
}
/** Upcoming sessions first (soonest first), then the rest by last change (the API exposes creation time). */
export function sortTrainings<T extends Pick<Course, 'id' | 'sessions'> & { created_at?: string }>(courses: T[], now = Date.now()) {
  return [...courses].sort((a, b) => {
    const sa = nextSession(a, now), sb = nextSession(b, now);
    if (sa && sb) return Date.parse(sa.starts_at) - Date.parse(sb.starts_at) || b.id - a.id;
    if (sa || sb) return sa ? -1 : 1;
    return (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0) || b.id - a.id;
  });
}
/** "Tue 17 Nov, 9:00" in the reader's language. */
export function shortWhen(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
/** The next scheduled mail across all sessions. */
export function nextMail(overview: Pick<TrainingOverview, 'sessions'>, now = Date.now()) {
  return overview.sessions.flatMap(s => s.emails.filter(e => e.state === 'scheduled' && e.scheduled_at && Date.parse(e.scheduled_at) >= now).map(e => ({ ...e, session: s })))
    .sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!))[0];
}
export const MAIL_KINDS: Record<string, string> = { session_tomorrow: 'Session tomorrow', quiz_ready: 'Quiz ready', quiz_reminder: 'Quiz reminder' };
export const MAIL_STATES: Record<string, string> = { scheduled: 'Scheduled', produced: 'Sent', disabled: 'Off' };
/** Sessions a person can still be moved into. */
export const movableSessions = <T extends Pick<CourseSession, 'cancelled' | 'ends_at'>>(sessions: T[], now = Date.now()) =>
  sessions.filter(s => !s.cancelled && Date.parse(s.ends_at) > now);
