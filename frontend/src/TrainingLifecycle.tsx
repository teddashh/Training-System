import { useEffect, useState } from 'react';
import { api } from './api';
import { t, useLocale } from './i18n';
import { ErrorBox, Modal, Spinner } from './ui';
import type { Course, CourseSession } from './types';

type Preview = { title: string; counts: Record<string, number> };
const countLabels: Record<string, string> = {
  sessions: 'Sessions', enrollments: 'Enrollments', assignments: 'Assignments',
  questions: 'Questions', attempts: 'Attempts', invitations: 'Invitations', courses: 'Linked courses',
};

export function DeleteTraining({ kind, target, onDeleted }: {
  kind: 'course' | 'exam'; target: { id: number; title: string }; onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="danger-text" onClick={() => setOpen(true)}>{t(kind === 'course' ? 'Delete course' : 'Delete exam')}</button>
    {open && <DeleteDialog kind={kind} target={target} onClose={() => setOpen(false)} onDeleted={onDeleted} />}</>;
}

function DeleteDialog({ kind, target, onClose, onDeleted }: {
  kind: 'course' | 'exam'; target: { id: number; title: string }; onClose: () => void; onDeleted: () => void;
}) {
  useLocale();
  const [preview, setPreview] = useState<Preview | null>(null), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const path = `${kind}s/${target.id}/`;
  useEffect(() => { let active = true;
    api<Preview>(path + 'deletion-preview/').then(data => { if (active) setPreview(data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [path]);
  const blocked = kind === 'exam' && !!preview?.counts.attempts;
  async function remove(e: React.FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (!preview || confirmation !== preview.title || blocked || busy) return;
    setBusy(true); setError('');
    try { await api(path, 'DELETE', { confirm_title: confirmation }); onClose(); onDeleted(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={t(kind === 'course' ? 'Delete course' : 'Delete exam')} onClose={onClose} closeDisabled={busy}>
    <form className="modal-form" onSubmit={remove}>
      <h3>{preview?.title || target.title}</h3>
      {!preview && !error && <Spinner />}
      {preview && <>
        <p>{t(kind === 'course'
          ? 'Permanently delete this course, its content, sessions, enrollments, attendance, learning progress and assignments. Linked exams and their results are kept.'
          : 'Permanently delete this exam, its questions, invitations and assignments, and remove its course links. Courses are kept. Exams with attempts or results cannot be deleted.')}</p>
        <ul>{Object.entries(preview.counts).map(([key, value]) => <li key={key}>{t(countLabels[key])}: {value}</li>)}</ul>
        {blocked ? <p role="status" className="notice">{t('This exam has attempts or results and cannot be deleted. Unpublish it instead.')}</p>
          : <label>{t('Type the title to confirm')}<input autoComplete="off" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>}
      </>}
      <ErrorBox message={error} />
      <div className="modal-footer"><button type="button" className="btn" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
        <button className="btn danger-text" disabled={busy || !preview || blocked || confirmation !== preview.title}>{t(busy ? 'Deleting…' : 'Delete permanently')}</button></div>
    </form>
  </Modal>;
}

export function CancelTraining({ course, session, onSaved }: { course: Course; session?: CourseSession; onSaved: () => void }) {
  useLocale();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [selected, setSelected] = useState<CourseSession[]>([]);
  const available = (session ? [session] : course.sessions).filter(s => !s.cancelled && Date.parse(s.ends_at) > Date.now());
  if (!available.length && !open) return null;
  async function cancel() {
    setBusy(true); setError('');
    try {
      if (session) await api(`courses/${course.id}/sessions/${session.id}/`, 'PATCH', { cancelled: true, revision: selected[0].revision });
      else await api(`courses/${course.id}/cancel-training/`, 'POST', { sessions: selected.map(s => ({ id: s.id, revision: s.revision })) });
      setOpen(false); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <><button type="button" className="danger-text" onClick={() => { setSelected(available); setError(''); setOpen(true); }}>{t(session ? 'Cancel session' : 'Cancel training')}</button>
    {open && <Modal title={t(session ? 'Cancel session' : 'Cancel training')} onClose={() => setOpen(false)} closeDisabled={busy}>
      <div className="modal-form"><h3>{session?.title || course.title}</h3>
        <p>{t('Cancel {count} unfinished session(s)? Registration and learning for these sessions will stop. Enrollment and attendance records are kept. Registered participants will receive a cancellation notice.', { count: selected.length })}</p>
        <ul>{selected.map(s => <li key={s.id}>{s.title}</li>)}</ul>
        <ErrorBox message={error} /><div className="modal-footer">
          <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>{t('Keep sessions')}</button>
          <button type="button" className="btn danger-text" disabled={busy} onClick={() => void cancel()}>{t(busy ? 'Processing…' : 'Confirm cancellation')}</button>
        </div>
      </div>
    </Modal>}
  </>;
}
