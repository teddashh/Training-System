import { useCallback, useEffect, useState } from 'react';
import { Pencil, Search } from 'lucide-react';
import { api, ApiError } from './api';
import { appPath } from './paths';
import { countLabel, t, useLocale } from './i18n';
import { Badge, ErrorBox, Modal, Spinner } from './ui';
import { coverUrl } from './CourseCover';
import { CourseEditor } from './Courses';
import { SessionEditor } from './CourseSessions';
import { SessionCard } from './CourseIntro';
import SessionAttendance, { downloadSessionFile, type SessionFile } from './SessionAttendance';
import { PublishQuiz } from './AssessmentBlock';
import { EnrollmentDecision, enrollmentLabel, type Decision } from './Enrollments';
import ActionMenu from './ActionMenu';
import { CancelTraining, DeleteTraining } from './TrainingLifecycle';
import TrainingQuiz from './TrainingQuiz';
import PeopleBox, { SkippedLines, emptyNames, type PeopleNames } from './PeopleBox';
import { createdKey } from './NewTraining';
import {
  MAIL_KINDS, MAIL_STATES, accepted, emptyRoster, gated, hasPeople, notifiedCount, released, movableSessions, nextMail, rosterSignature, shortWhen, skipped,
  type EnrollmentPage, type EnrollmentRow, type RosterInput, type RosterReport, type RosterRow, type SessionOverview, type TrainingOverview,
} from './simpleTraining';
import type { Course } from './types';

type Tab = 'overview' | 'people';
type Created = { notified: number; skipped: RosterRow[] };
const tabFromUrl = (): Tab => new URLSearchParams(window.location.search).get('tab') === 'people' ? 'people' : 'overview';

function readCreated(course: number): Created | null {
  try { return JSON.parse(sessionStorage.getItem(createdKey(course)) || 'null'); } catch { return null; }
}

export default function TrainingPage({ id, go, onSaved }: { id: number; go: (path: string) => void; onSaved: () => void }) {
  useLocale();
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const [overview, setOverview] = useState<TrainingOverview | null>(null), [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState(''), [editing, setEditing] = useState(false);
  const [created, setCreated] = useState<Created | null>(() => readCreated(id));
  const [prefill, setPrefill] = useState<string | null>(null), [version, setVersion] = useState(0);
  // Shown once: a reload or a later visit does not repeat the confirmation.
  useEffect(() => { try { sessionStorage.removeItem(createdKey(id)); } catch { /* Storage can be disabled. */ } }, [id]);
  const load = useCallback(async () => {
    const [next, full] = await Promise.all([api<TrainingOverview>(`courses/${id}/training/`), api<Course>(`courses/${id}/`)]);
    setOverview(next); setCourse(full); setError('');
    return full;
  }, [id]);
  useEffect(() => {
    let active = true;
    load().then(full => { if (active && full.delivery_mode !== 'scheduled') go(`/authoring?course=${id}&action=edit`); })
      .catch(e => { if (active) setError((e as Error).message); });
    return () => { active = false; };
  }, [load, id, go]);
  useEffect(() => {
    const pop = () => setTab(tabFromUrl());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const refresh = useCallback(() => { setVersion(v => v + 1); onSaved(); return load().catch(e => setError((e as Error).message)); }, [load, onSaved]);
  function openTab(next: Tab) {
    if (next === tab) return;
    const url = new URL(window.location.href);
    if (next === 'people') url.searchParams.set('tab', 'people'); else url.searchParams.delete('tab');
    history.pushState({}, '', url);
    setTab(next);
  }
  if (error && !overview) return <ErrorBox message={error} />;
  if (!overview || !course) return <Spinner />;
  const state = !overview.published ? 'Draft' : overview.release_at && Date.parse(overview.release_at) > Date.now() ? 'Scheduled' : '';
  const tabLink = (value: Tab, label: string) => <a href={appPath(`/authoring/${id}${value === 'people' ? '?tab=people' : ''}`)} aria-current={tab === value ? 'page' : undefined}
    onClick={event => { event.preventDefault(); openTab(value); }}>{t(label)}</a>;
  return <div className="training-page">
    <div className="page-heading training-heading">
      <div className="training-title"><img className="training-thumb" src={coverUrl(course.cover)} alt="" /><h1>{overview.title}</h1>{state && <Badge tone="amber">{t(state)}</Badge>}</div>
      <div className="heading-actions"><button type="button" className="btn" onClick={() => setEditing(true)}><Pencil size={16} />{t('Edit')}</button>
        <ActionMenu title={course.title} label={t('More')}>
          <CancelTraining course={course} onSaved={() => void refresh()} />
          <DeleteTraining kind="course" target={course} onDeleted={() => { onSaved(); go('/authoring'); }} />
        </ActionMenu>
      </div>
    </div>
    {created && <div className="notice training-created" role="status">
      <p>{created.notified ? countLabel(created.notified, 'Training created. {count} person notified.', 'Training created. {count} people notified.') : t('Training created.')}</p>
      {created.skipped.length > 0 && <><p>{t('{count} skipped', { count: created.skipped.length })}</p><SkippedLines rows={created.skipped} />
        <button type="button" className="btn" onClick={() => { setPrefill(created.skipped.map(row => row.input).join('\n')); setCreated(null); openTab('people'); }}>{t('Add people')}</button></>}
    </div>}
    <nav className="training-tabs" aria-label={t('Training')}>{tabLink('overview', 'Overview')}{tabLink('people', 'People')}</nav>
    <ErrorBox message={error} />
    {tab === 'overview'
      ? <Overview overview={overview} course={course} onChanged={refresh} />
      : <People overview={overview} course={course} version={version} prefill={prefill} onPrefilled={() => setPrefill(null)} onChanged={refresh} />}
    {editing && <CourseEditor course={course} onClose={() => setEditing(false)} onSaved={() => void refresh()} />}
  </div>;
}

function RegistrationShare({ overview, onChanged }: { overview: TrainingOverview; onChanged: () => void }) {
  useLocale();
  const [copied, setCopied] = useState(false), [fallback, setFallback] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const link = overview.registration_url && new URL(overview.registration_url, window.location.origin).href;
  async function copy() {
    if (!link) return;
    setCopied(false);
    try { await navigator.clipboard.writeText(link); setCopied(true); setFallback(false); }
    catch { setFallback(true); }
  }
  async function create() {
    setBusy(true); setError('');
    try { await api(`courses/${overview.id}/registration-link/`, 'POST', { rotate: false }); onChanged(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="training-section" aria-label={t('Registration link')}>
    <div className="heading-actions training-share">
      {link ? <button type="button" className="btn primary" onClick={() => void copy()}>{t(copied ? 'Copied' : 'Copy link')}</button>
        : <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>{t('Create link')}</button>}
      {link && <p className="muted">{t('Anyone with it can register or switch session.')}</p>}
    </div>
    {fallback && link && <div className="registration-share"><label>{t('Registration link')}<input readOnly value={link} onFocus={e => e.target.select()} /></label></div>}
    <ErrorBox message={error} />
  </section>;
}

function sessionFacts(session: SessionOverview) {
  const { registered, pending, present, absent } = session.counts;
  const parts = [t('{registered} of {capacity} registered', { registered, capacity: session.capacity })];
  if (pending) parts.push(t('{count} pending', { count: pending }));
  if (Date.parse(session.ends_at) <= Date.now() && present + absent > 0) parts.push(t('{present} present · {absent} absent', { present, absent }));
  return parts.join(' · ');
}

function Sessions({ overview, course, onChanged }: { overview: TrainingOverview; course: Course; onChanged: () => void }) {
  useLocale();
  const [editing, setEditing] = useState<SessionOverview | null | undefined>(), [attendance, setAttendance] = useState<SessionOverview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function download(session: SessionOverview, kind: SessionFile) {
    setBusy(true); setError('');
    try { await downloadSessionFile(course.id, session.id, kind); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function closeAttendance() { setAttendance(null); onChanged(); }
  return <section className="training-section">
    <h2>{t('Sessions')}</h2>
    <div className="session-list">{overview.sessions.map(session => {
      return <SessionCard key={session.id} session={session} seats={sessionFacts(session)}>
        <div className="session-file-pair">
          <button type="button" className="btn small" disabled={busy} onClick={() => void download(session, 'sign-in-pdf')}>{t('Sign-in sheet')}</button>
          <button type="button" className="btn small" disabled={busy} onClick={() => void download(session, 'sign-in')}>{t('Excel')}</button>
        </div>
        <button type="button" className="btn small" onClick={() => setAttendance(session)}>{t('Attendance')}</button>
        <ActionMenu title={session.title}>
          <button type="button" onClick={() => setEditing(session)}>{t('Edit')}</button>
          <CancelTraining course={course} session={session} onSaved={onChanged} />
        </ActionMenu>
      </SessionCard>;
    })}</div>
    <ErrorBox message={error} />
    <button type="button" className="btn" onClick={() => setEditing(null)}>{t('Add session')}</button>
    {editing !== undefined && <SessionEditor course={course} session={editing} onClose={() => setEditing(undefined)} onSaved={onChanged} />}
    {attendance && <Modal title={`${t('Attendance')} · ${attendance.title}`} wide onClose={closeAttendance}>
      <div className="modal-form"><SessionAttendance heading={false} course={course} session={attendance} refreshKey={0} onSaved={() => {}} />
        <div className="modal-footer"><button type="button" className="btn primary" onClick={closeAttendance}>{t('Done')}</button></div>
      </div>
    </Modal>}
  </section>;
}

function Quiz({ overview, course, onChanged }: { overview: TrainingOverview; course: Course; onChanged: () => void }) {
  useLocale();
  const [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function link(exam: number | null) {
    if (!exam) return;
    setBusy(true); setError('');
    try { await api(`courses/${course.id}/assessments/`, 'POST', { exam, attach: true, release: 'after_session', publish: true }); setAdding(false); onChanged(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="training-section">
    <h2>{t('Quiz')}</h2>
    {overview.quizzes.map(quiz => {
      const full = course.assessments.find(row => row.id === quiz.id);
      return <div className="assessment-summary training-quiz-row" key={quiz.id}>
        <strong>{quiz.title}</strong>
        <span className="muted">{t(quiz.release === 'after_session' && gated(quiz) ? 'Opens after each session' : 'Open now')}</span>
        {quiz.published && (quiz.participation.passed > 0 || overview.sessions.some(session => Date.parse(session.ends_at) <= Date.now())) &&
          <span className="muted">{t('{passed} of {people} passed', { passed: quiz.participation.passed, people: overview.people })}</span>}
        {!quiz.published && <div className="heading-actions"><Badge tone="amber">{t('Draft: participants cannot take it')}</Badge>
          {full && <PublishQuiz exam={full} onChanged={onChanged} />}</div>}
      </div>;
    })}
    {!overview.quizzes.length && (adding ? <TrainingQuiz value={null} disabled={busy} onChange={value => void link(value)} />
      : <button type="button" className="btn" onClick={() => setAdding(true)}>{t('Add quiz')}</button>)}
    <ErrorBox message={error} />
  </section>;
}

function Emails({ overview, onChanged }: { overview: TrainingOverview; onChanged: () => void }) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const next = nextMail(overview);
  const events = overview.sessions.flatMap(session => session.emails.filter(e => e.state !== 'superseded').map(e => ({ ...e, session })))
    .sort((a, b) => Date.parse(a.scheduled_at || '') - Date.parse(b.scheduled_at || ''));
  async function toggle(reminders: boolean) {
    setBusy(true); setError('');
    try { await api(`courses/${overview.id}/`, 'PATCH', { reminders }); onChanged(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="training-section">
    <label className="checkbox-label training-switch"><input type="checkbox" role="switch" checked={overview.reminders} disabled={busy} onChange={e => void toggle(e.target.checked)} />{t('E-mail reminders')}</label>
    <p className="muted">{next ? t('Next: {what} · {when}', { what: t(MAIL_KINDS[next.kind] || next.kind), when: shortWhen(next.scheduled_at!, locale) }) : t('Nothing scheduled')}</p>
    <ErrorBox message={error} />
    {events.length > 0 && <details className="course-options">
      <summary>{t('All e-mails')}</summary>
      <ul className="training-mail-list">{events.map((event, i) => <li key={i}>
        <span>{t(MAIL_KINDS[event.kind] || event.kind)}</span>
        <span className="muted">{event.session.title}{event.scheduled_at ? ` · ${shortWhen(event.produced_at || event.scheduled_at, locale)}` : ''}</span>
        <Badge tone={event.state === 'produced' ? 'teal' : 'neutral'}>{t(MAIL_STATES[event.state] || event.state)}</Badge>
      </li>)}</ul>
    </details>}
  </section>;
}

function Overview(props: { overview: TrainingOverview; course: Course; onChanged: () => void }) {
  return <>
    <RegistrationShare overview={props.overview} onChanged={props.onChanged} />
    <Sessions {...props} />
    <Quiz {...props} />
    <Emails overview={props.overview} onChanged={props.onChanged} />
  </>;
}

const FILTERS = [
  { key: 'all', label: 'All', status: 'all' }, { key: 'registered', label: 'Registered', status: 'approved' },
  { key: 'pending', label: 'Pending', status: 'pending' }, { key: 'attended', label: 'Present', status: 'all', attendance: 'present' },
  { key: 'absent', label: 'Absent', status: 'all', attendance: 'absent' }, { key: 'cancelled', label: 'Cancelled', status: 'cancelled' },
] as const;
const statusLabel = (row: EnrollmentRow) => {
  const base = row.status === 'approved' ? t('Registered') : row.status === 'pending' ? t('Pending') : row.status === 'cancelled' ? t('Cancelled') : enrollmentLabel(row.status);
  // Once a registered person is marked, the mark is the status: one word, the same as in the attendance list.
  return row.status === 'approved' && row.effective_attendance ? t(row.effective_attendance === 'present' ? 'Present' : 'Absent') : base;
};

function AddPeople({ overview, course, prefill, onClose, onAdded }: { overview: TrainingOverview; course: Course; prefill: string; onClose: () => void; onAdded: () => void }) {
  useLocale();
  const open = movableSessions(overview.sessions), notify = released(overview);
  const [session, setSession] = useState(open[0]?.id || 0);
  const [roster, setRoster] = useState<RosterInput>({ ...emptyRoster(), text: prefill }), [names, setNames] = useState<PeopleNames>(emptyNames);
  const [check, setCheck] = useState<{ signature: string; report: RosterReport } | null>(null), [checking, setChecking] = useState(false);
  const [result, setResult] = useState<RosterReport | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [peopleError, setPeopleError] = useState('');
  /** Validation (such as the line limit) belongs under the People box; anything else below the form. */
  function fail(e: unknown) { if (e instanceof ApiError && e.status === 400) setPeopleError(e.message); else setError((e as Error).message); }
  const body = (value: RosterInput, dryRun: boolean) => ({ session, ...value, text: value.text.trim(), dry_run: dryRun, notify: notify && !dryRun });
  async function dryRun(value: RosterInput, target = session) {
    if (!hasPeople(value) || !target) return;
    setChecking(true);
    try { setCheck({ signature: rosterSignature(value) + target, report: await api<RosterReport>(`courses/${course.id}/roster/`, 'POST', { ...body(value, true), session: target }) }); setError(''); setPeopleError(''); }
    catch (e) { fail(e); } finally { setChecking(false); }
  }
  // Skipped lines handed over from creation are checked straight away.
  useEffect(() => { if (prefill) void dryRun(roster); }, []);
  async function upload(file: File) {
    const data = new FormData();
    data.append('session', String(session)); data.append('dry_run', 'true'); data.append('notify', 'false'); data.append('file', file);
    return (await api<RosterReport>(`courses/${course.id}/roster/`, 'POST', data)).rows.map(row => row.input);
  }
  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !hasPeople(roster)) return;
    setBusy(true); setError('');
    try { setResult(await api<RosterReport>(`courses/${course.id}/roster/`, 'POST', body(roster, false))); setRoster(emptyRoster()); setNames(emptyNames()); setCheck(null); setPeopleError(''); onAdded(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  }
  const report = check && check.signature === rosterSignature(roster) + session ? check.report : undefined;
  if (!open.length) return <p className="muted">{t('No open sessions.')}</p>;
  return <form className="training-section training-add" onSubmit={e => void add(e)} aria-busy={busy}>
    {result && <div className="notice" role="status"><p>{countLabel(accepted(result), '{count} person added.', '{count} people added.')}{notifiedCount([result]) > 0 && ` ${countLabel(notifiedCount([result]), '{count} person notified.', '{count} people notified.')}`}</p>{skipped(result).length > 0 && <SkippedLines rows={skipped(result)} />}</div>}
    <fieldset className="training-fields-stack" disabled={busy}>
      {open.length > 1 && <div className="training-field"><label htmlFor="training-add-session">{t('Session')}</label>
        <select id="training-add-session" value={session} onChange={e => { setSession(Number(e.target.value)); void dryRun(roster, Number(e.target.value)); }}>
          {open.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select></div>}
      <PeopleBox id="training-add-people" value={roster} names={names} report={report} checking={checking && !report}
        error={peopleError} onChange={(value, next) => { setRoster(value); setNames(next); setResult(null); setPeopleError(''); }} onCheck={value => void dryRun(value)} onUpload={upload} />
      <ErrorBox message={error} />
      <div className="heading-actions training-submit">
        <button className="btn primary" disabled={busy || !hasPeople(roster)}>{t(busy ? 'Adding…' : notify ? 'Add and notify' : 'Add')}</button>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>{t('Close')}</button>
      </div>
    </fieldset>
  </form>;
}

function People({ overview, course, version, prefill, onPrefilled, onChanged }: {
  overview: TrainingOverview; course: Course; version: number; prefill: string | null; onPrefilled: () => void; onChanged: () => void;
}) {
  const locale = useLocale();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all'), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [data, setData] = useState<EnrollmentPage | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [adding, setAdding] = useState<string | null>(prefill), [deciding, setDeciding] = useState<{ row: EnrollmentRow; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  useEffect(() => { if (prefill !== null) { setAdding(prefill); onPrefilled(); } }, [prefill, onPrefilled]);
  const chosen = FILTERS.find(f => f.key === filter)!;
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ status: chosen.status, page: String(page), search: search.trim() });
      api<EnrollmentPage>(`courses/${course.id}/enrollments/?${params}`)
        .then(result => { if (active) { setData(result); setError(''); } })
        .catch(e => { if (active) setError((e as Error).message); })
        .finally(() => { if (active) setLoading(false); });
    }, search ? 200 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [course.id, chosen.status, page, search, version, reload]);
  function changed() { setReload(v => v + 1); onChanged(); }
  async function move(row: EnrollmentRow, target: SessionOverview) {
    setBusy(true); setError(''); setMessage('');
    try {
      const report = await api<RosterReport>(`courses/${course.id}/roster/`, 'POST', { session: target.id, people: [row.user_id], move_started: true, notify: released(overview) });
      if (report.rows[0]?.outcome === 'moved') setMessage(t('{name} moved to {session}.', { name: row.person, session: target.title }));
      else setMessage(t('Not moved.'));
      changed();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const counts = data?.counts || {};
  const hasQuiz = overview.quizzes.some(quiz => quiz.published);
  const rows = (data?.results || []).filter(row => !('attendance' in chosen) || row.effective_attendance === chosen.attendance);
  const targets = movableSessions(overview.sessions);
  const pages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1;
  return <>
    <div className="heading-actions training-filters" role="group" aria-label={t('Status')}>
      {FILTERS.filter(f => ['all', 'registered'].includes(f.key) || counts[f.key]).map(f => <button key={f.key} type="button" className="btn" aria-pressed={filter === f.key}
        onClick={() => { setFilter(f.key); setPage(1); }}>{t(f.label)} <span className="count">{counts[f.key] || 0}</span></button>)}
    </div>
    {adding === null ? <button type="button" className="btn primary training-add-toggle" onClick={() => setAdding('')}>{t('Add people')}</button>
      : <AddPeople overview={overview} course={course} prefill={adding} onClose={() => setAdding(null)} onAdded={changed} />}
    {(counts.all || 0) > 10 && <div className="search-field training-search"><Search size={16} /><input aria-label={t('Search people')} placeholder={t('Search people')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>}
    <div role="status">{message}</div>
    <ErrorBox message={error} />
    {loading && !data ? <Spinner /> : rows.length ? <div className="people-table training-table"><table>
      <thead><tr><th>{t('Name')}</th><th>{t('Department')}</th><th>{t('Session')}</th><th>{t('Status')}</th>{hasQuiz && <th>{t('Quiz')}</th>}<th><span className="sr-only">{t('Actions')}</span></th></tr></thead>
      <tbody>{rows.map(row => {
        const moves = row.session && ['approved', 'pending'].includes(row.status) && row.effective_attendance !== 'present' ? targets.filter(s => s.id !== row.session!.id) : [];
        return <tr key={row.id}>
          <td><strong>{row.person}</strong>{!row.active && <small className="muted"> · {t('Inactive')}</small>}</td>
          <td data-label={t('Department')} className={row.department ? undefined : 'is-empty'}>{row.department || '—'}</td>
          <td data-label={t('Session')}>{row.session ? `${row.session.title} · ${shortWhen(row.session.starts_at, locale)}` : '—'}</td>
          <td data-label={t('Status')} className="training-status">{statusLabel(row)}</td>
          {hasQuiz && <td data-label={t('Quiz')} data-prefix={t('Quiz') + (locale === 'zh-TW' ? '：' : ': ')} className="training-quiz-cell">{row.quiz ? t(row.quiz === 'passed' ? 'Passed' : row.quiz === 'not_passed' ? 'Not passed' : 'Not started') : '—'}</td>}
          <td className="people-row-actions"><ActionMenu title={row.person}>
            {moves.map(target => <button type="button" key={target.id} disabled={busy} onClick={() => void move(row, target)}>{t('Move to {session}', { session: target.title })}</button>)}
            {row.status !== 'approved' && <button type="button" disabled={!row.active} onClick={() => setDeciding({ row, decision: 'approved' })}>{t('Approve')}</button>}
            {row.status === 'pending' && <button type="button" onClick={() => setDeciding({ row, decision: 'rejected' })}>{t('Reject')}</button>}
            {row.status === 'approved' && <button type="button" className="danger-text" onClick={() => setDeciding({ row, decision: 'removed' })}>{t('Remove')}</button>}
          </ActionMenu></td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="muted">{t('No people yet.')}</p>}
    {data && data.count > data.page_size && <div className="enrollment-pagination">
      <button type="button" className="btn" disabled={loading || data.page <= 1} onClick={() => setPage(data.page - 1)}>{t('Previous')}</button>
      <span>{data.page} / {pages}</span>
      <button type="button" className="btn" disabled={loading || data.page >= pages} onClick={() => setPage(data.page + 1)}>{t('Next')}</button>
    </div>}
    {deciding && <Modal title={t(deciding.decision === 'approved' ? 'Approve' : deciding.decision === 'rejected' ? 'Reject' : 'Remove')} onClose={() => setDeciding(null)}>
      <div className="modal-form"><EnrollmentDecision course={course} row={deciding.row} decision={deciding.decision} cancelLabel={t('Cancel')}
        onCancel={() => setDeciding(null)} onDone={() => { setDeciding(null); changed(); }} /></div>
    </Modal>}
  </>;
}
