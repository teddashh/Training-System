import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, ApiError } from './api';
import { t, useLocale } from './i18n';
import { ErrorBox } from './ui';
import { zoneName } from './datetime';
import CourseCover, { suggestCover } from './CourseCover';
import TrainingQuiz from './TrainingQuiz';
import PeopleBox, { emptyNames, type PeopleNames } from './PeopleBox';
import {
  MAX_SESSIONS, accepted, formErrors, notifiedCount, hasPeople, localDay, newSession, receiptReports, rosterSignature, skipped, trainingPayload,
  updateSession, validateTraining, type RosterInput, type RosterReport, type SessionDraft, type TrainingReceipt,
} from './simpleTraining';

type Check = { signature: string; report: RosterReport };
export const createdKey = (course: number) => `training-created:${course}`;

/** Asks once before typed data is lost: on reload/close and on any in-app link outside the form. */
function useLeaveGuard(dirty: boolean) {
  const leaving = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (!leaving.current) { event.preventDefault(); event.returnValue = ''; } };
    const click = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest?.('a[href]');
      if (!link || leaving.current || link.closest('.training-form') || (link as HTMLAnchorElement).target === '_blank') return;
      if (window.confirm(t('Discard this training?'))) leaving.current = true;
      else { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', click, true); };
  }, [dirty]);
  return leaving;
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return <div className="training-field"><label htmlFor={id}>{label}</label>{children}{error && <span className="field-hint danger-text" id={id + '-error'}>{t(error)}</span>}</div>;
}

export default function NewTraining({ go }: { go: (path: string) => void }) {
  const locale = useLocale();
  // One request per opened form: a double click or a retry replays the first receipt.
  const [requestId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(''), [description, setDescription] = useState('');
  const [cover, setCover] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionDraft[]>(() => { const first = newSession(); return [first, newSession(first)]; });
  const [names, setNames] = useState<Record<string, PeopleNames>>({});
  const [exam, setExam] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, Check>>({}), [checking, setChecking] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null), latest = useRef(sessions), checkRun = useRef(0);
  latest.current = sessions;
  const dirty = !!(title.trim() || description.trim() || exam || sessions.some(s => s.date || s.start || s.end || s.location.trim() || hasPeople(s.roster)));
  const leaving = useLeaveGuard(dirty && !busy);
  const today = localDay(new Date());
  const notify = sessions.some(s => s.date && hasPeople(s.roster));
  const zone = zoneName(locale);

  function clear(...keys: string[]) { setErrors(current => { const next = { ...current }; keys.forEach(key => delete next[key]); return next; }); }
  function patch(index: number, values: Partial<SessionDraft>, ...fields: string[]) {
    setSessions(current => updateSession(current, index, values));
    clear(...fields.map(field => `sessions[${index}].${field}`));
  }
  function focusProblem() { requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }

  /** Every box is checked together so that people listed in two sessions are reported. */
  async function check(index: number, roster: RosterInput) {
    const boxes = latest.current.map((s, i) => i === index ? roster : s.roster);
    if (!boxes.some(hasPeople)) return;
    const run = ++checkRun.current;
    setChecking(run);
    try {
      const result = await api<{ rosters: RosterReport[] }>('trainings/check-people/', 'POST', { rosters: boxes.map(box => ({ ...box, text: box.text.trim() })) });
      if (run !== checkRun.current) return;
      const keys = latest.current.map(s => s.key);
      setChecks(Object.fromEntries(boxes.flatMap((box, i) => hasPeople(box) && result.rosters[i] ? [[keys[i], { signature: rosterSignature(box), report: result.rosters[i] }]] : [])));
      clear(...boxes.map((_, i) => `people[${i}]`));
    } catch (e) {
      if (run !== checkRun.current) return;
      // Server limits (lines, characters) come back per roster and land under the box they concern.
      const found: Record<string, string> = {};
      const body = e instanceof ApiError && e.status === 400 ? e.fields || {} : {};
      for (const [field, value] of Object.entries(body)) {
        const at = /^rosters\[(\d+)\]/.exec(field), message = Array.isArray(value) ? value.filter(v => typeof v === 'string').join(' ') : typeof value === 'string' ? value : '';
        if (at && message) found[`people[${at[1]}]`] = message;
      }
      if (!Object.keys(found).length) found[`people[${index}]`] = (e as Error).message;
      setErrors(current => ({ ...current, ...found }));
    } finally { if (run === checkRun.current) setChecking(0); }
  }
  async function upload(file: File) {
    const data = new FormData();
    data.append('file', file);
    const result = await api<{ rosters: RosterReport[] }>('trainings/check-people/', 'POST', data);
    return (result.rosters[0]?.rows || []).map(row => row.input);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const found = validateTraining(title, sessions);
    setErrors(found);
    if (Object.keys(found).length) { focusProblem(); return; }
    setBusy(true);
    try {
      const payload = trainingPayload({ requestId, title, description, cover: cover || suggestCover(title), sessions, exam });
      const receipt = await api<TrainingReceipt>('trainings/', 'POST', payload);
      const reports = receiptReports(receipt);
      try {
        sessionStorage.setItem(createdKey(receipt.course), JSON.stringify({
          notified: notifiedCount(reports),
          skipped: reports.flatMap(report => skipped(report)),
        }));
      } catch { /* The training page still opens without the confirmation line. */ }
      leaving.current = true;
      go(`/authoring/${receipt.course}`);
    } catch (e) {
      const fields = e instanceof ApiError && e.status === 400 ? formErrors(e.fields, sessions) : {};
      const { general, ...rest } = fields;
      setErrors(rest);
      setError(general || (Object.keys(rest).length ? '' : (e as Error).message));
      focusProblem();
      setBusy(false);
    }
  }
  function cancel() {
    if (dirty && !window.confirm(t('Discard this training?'))) return;
    leaving.current = true;
    go('/authoring');
  }

  const fieldError = (key: string) => errors[key];
  const invalid = (key: string) => ({ 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `${fieldId(key)}-error` : undefined });
  const fieldId = (key: string) => 'training-' + key.replace(/[^\w]+/g, '-');
  return <>
    <div className="page-heading"><h1>{t('New training')}</h1></div>
    <form ref={form} className="panel modal-form training-form" onSubmit={e => void submit(e)} noValidate aria-busy={busy}>
      <Field id={fieldId('title')} label={t('Title')} error={fieldError('title')}>
        <input id={fieldId('title')} value={title} maxLength={200} disabled={busy} {...invalid('title')} onChange={e => { setTitle(e.target.value); clear('title'); }} />
      </Field>
      {sessions.map((session, i) => {
        const key = (field: string) => `sessions[${i}].${field}`;
        const result = checks[session.key];
        const report = result && result.signature === rosterSignature(session.roster) ? result.report : undefined;
        const people = accepted(report), seats = Number(session.capacity);
        return <fieldset className="training-session" key={session.key} disabled={busy}>
          <legend>{t('Session {number}', { number: i + 1 })}</legend>
          {i > 0 && <button type="button" className="text-btn training-session-remove" onClick={() => { setSessions(current => current.filter(s => s.key !== session.key)); setErrors({}); }}>{t('Remove')}</button>}
          <div className="training-fields training-when">
            <Field id={fieldId(key('date'))} label={t('Date')} error={fieldError(key('date'))}>
              <input id={fieldId(key('date'))} type="date" min={today} value={session.date} {...invalid(key('date'))} onChange={e => patch(i, { date: e.target.value }, 'date', 'starts_at')} />
            </Field>
            <Field id={fieldId(key('starts_at'))} label={t('Start')} error={fieldError(key('starts_at'))}>
              <input id={fieldId(key('starts_at'))} type="time" value={session.start} {...invalid(key('starts_at'))} onChange={e => patch(i, { start: e.target.value }, 'starts_at', 'ends_at')} />
            </Field>
            <Field id={fieldId(key('ends_at'))} label={t('End')} error={fieldError(key('ends_at'))}>
              <input id={fieldId(key('ends_at'))} type="time" value={session.end} {...invalid(key('ends_at'))} onChange={e => patch(i, { end: e.target.value }, 'ends_at')} />
            </Field>
          </div>
          {i === 0 && <p className="field-hint">{t('Times shown in {zone}', { zone })}</p>}
          <div className="training-fields training-where">
            <Field id={fieldId(key('location'))} label={t('Place')} error={fieldError(key('location'))}>
              <input id={fieldId(key('location'))} value={session.location} maxLength={200} {...invalid(key('location'))} onChange={e => patch(i, { location: e.target.value }, 'location')} />
            </Field>
            <Field id={fieldId(key('capacity'))} label={t('Seats')} error={fieldError(key('capacity'))}>
              <input id={fieldId(key('capacity'))} type="number" inputMode="numeric" min={1} max={10000} value={session.capacity} {...invalid(key('capacity'))} onChange={e => patch(i, { capacity: e.target.value }, 'capacity')} />
              {people > seats && seats > 0 && <span className="field-hint training-warning" role="status">{t('{people} people, {seats} seats', { people, seats })}</span>}
            </Field>
          </div>
          <PeopleBox id={`training-people-${i}`} value={session.roster} names={names[session.key] || emptyNames()}
            report={report} checking={checking > 0 && hasPeople(session.roster) && !report} error={errors[`people[${i}]`]}
            onChange={(roster, next) => { setSessions(current => current.map(s => s.key === session.key ? { ...s, roster } : s)); setNames(current => ({ ...current, [session.key]: next })); }}
            onCheck={roster => void check(i, roster)} onUpload={upload} />
        </fieldset>;
      })}
      {sessions.length < MAX_SESSIONS && <button type="button" className="btn dashed training-add-session" disabled={busy} onClick={() => setSessions(current => [...current, newSession(current[0])])}><Plus size={16} />{t('Add session')}</button>}
      <div className="training-field">
        <TrainingQuiz value={exam} disabled={busy} onChange={value => { setExam(value); clear('exam'); }} />
        {errors.exam && <span className="field-hint danger-text">{errors.exam}</span>}
      </div>
      <ErrorBox message={error} />
      <div className="heading-actions training-submit">
        <button className="btn primary" disabled={busy}>{t(busy ? 'Creating…' : notify ? 'Create and notify' : 'Create')}</button>
        <button type="button" className="btn" disabled={busy} onClick={cancel}>{t('Cancel')}</button>
      </div>
      <details className="course-options">
        <summary>{t('More options')}</summary>
        <div className="training-field">
          <label htmlFor="training-description">{t('Description')}</label>
          <textarea id="training-description" rows={3} value={description} disabled={busy} onChange={e => setDescription(e.target.value)} />
        </div>
        <CourseCover compact value={cover || suggestCover(title)} title={title} onChange={setCover} />
      </details>
    </form>
  </>;
}
