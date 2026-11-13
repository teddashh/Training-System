import ActionMenu from "./ActionMenu";
import { formatDateTime } from "./datetime";
import { useRef, useState } from "react";
import type { Assessment, Course } from "./types";
import { t, useLocale } from "./i18n";
import { api } from "./api";
import { Badge, ErrorBox, Modal } from "./ui";
import { appPath } from "./paths";
import { examLearnerState } from "./examLearnerState";
import { RetryNotice, useRetryStatus, type RetryInfo } from './RetryAvailability';

export function AssessmentWindow({exam}: {exam: Pick<Assessment, "starts_at" | "ends_at">}) {
  const locale = useLocale();
  if (exam.starts_at && Date.parse(exam.starts_at) > Date.now()) return <p className="muted">{t("Opens {time}", {time: formatDateTime(exam.starts_at, locale, {zone: true})})}</p>;
  if (exam.ends_at && Date.parse(exam.ends_at) <= Date.now()) return <p className="muted">{t("Assessment closed")}</p>;
  return null;
}

export function ExamLearnerActions({exam, personal = false, showWindow = true, secondary = true}: {
  exam: Pick<Assessment, "id" | "active_attempt_id" | "last_result" | "attempts_remaining" | "starts_at" | "ends_at"> & Partial<RetryInfo>; personal?: boolean; showWindow?: boolean; secondary?: boolean;
}) {
  const {now} = useRetryStatus({...exam, next_attempt_at: exam.next_attempt_at || null});
  const {state} = examLearnerState(exam, now);
  const result = exam.last_result && appPath(`/attempt/${exam.last_result.id}`);
  const start = appPath(`/exams?exam=${exam.id}&action=start`);
  const linkClass = personal ? "btn" : "text-btn";
  if (state === 'waiting' || state === 'grading') return <>
    <button type="button" className={linkClass} disabled>{t(state === 'grading' ? 'Awaiting grading' : exam.attempts_used === 0 ? 'Start' : 'Retake')}</button>
    {result && <a className="text-btn" href={result}>{t('View results')}</a>}
  </>;
  if (state === "completed") return result
    ? <a className={linkClass} href={result}>{t(personal ? "View results" : "View result")}</a>
    : <button className={linkClass} disabled>{t("No attempts remaining")}</button>;
  if (state === "upcoming") return showWindow ? <AssessmentWindow exam={exam}/> : null;
  if (state === "closed") return <>
    {showWindow && <AssessmentWindow exam={exam}/>}
    {result && <a className={linkClass} href={result}>{t("View results")}</a>}
  </>;
  return <>
    <a className={linkClass} href={start}>{t(state === "active" ? personal ? "Resume" : "Continue" : state === "retake" ? "Retake" : personal ? "Start" : "Take assessment")}</a>
    {state === "retake" && secondary && result && <a className="text-btn" href={result}>{t("View results")}</a>}
  </>;
}

export function ParticipantLink({exam}: {exam: Pick<Assessment, "id" | "published" | "audience">}) {
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const link = window.location.origin + appPath(`/exams?exam=${exam.id}`);
  async function copy() {
    setCopied(false);
    if (!navigator.clipboard) { setShowFallback(true); return; }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setShowFallback(false);
    } catch { setShowFallback(true); }
  }
  if (!exam.published || exam.audience === "invitation") return null;
  return <>
    <button type="button" className="btn" onClick={() => void copy()}>{t(copied ? "Link copied" : "Copy participant link")}</button>
    {showFallback && <div className="registration-share participant-link-fallback">
      <label>{t("Participant link")}<input type="text" readOnly value={link} onFocus={event => event.target.select()}/></label>
    </div>}
  </>;
}

export function InvitationOnlyNotice({exam}: {exam: Pick<Assessment, "audience" | "can_manage">}) {
  if (exam.audience !== "invitation") return null;
  return <>
    <Badge tone="neutral">{t("Invitation only")}</Badge>
    <p className="muted">{t("This quiz requires an invitation.")}</p>
    {exam.can_manage && <p className="muted">{t("Change the audience to allow course participants.")}</p>}
  </>;
}

export function PublishQuiz({exam, onChanged, courseUnpublished = false}: {
  exam: Pick<Assessment, "id" | "title" | "published" | "can_manage" | "audience" | "question_count">;
  onChanged?: () => void | Promise<unknown>; courseUnpublished?: boolean;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [open, setOpen] = useState(false), [audience, setAudience] = useState<'course' | 'all'>('course');
  const row = useRef<HTMLElement | null>(null);
  if (!onChanged || (exam.published && !open) || !exam.can_manage || exam.audience === "invitation") return null;
  const effectiveAudience = exam.audience === 'all' ? audience : exam.audience;
  const message = t(effectiveAudience === "course"
    ? "Publish “{title}”? Approved participants of this course can take it."
    : effectiveAudience === "all"
    ? "Publish “{title}”? Everyone with an account can take it, not only this course's participants."
    : "Publish “{title}”? Its exam audience and approved participants of this course can take it.", {title: exam.title});
  async function publish() {
    setBusy(true); setError("");
    try {
      await api(`exams/${exam.id}/`, "PATCH", {published: true, ...(exam.audience === 'all' && audience === 'course' ? {audience: 'course'} : {})});
      await onChanged!(); setOpen(false);
      requestAnimationFrame(() => row.current?.querySelector<HTMLElement>('button:not(:disabled),a[href]')?.focus());
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="btn" disabled={busy || !exam.question_count} onClick={event => {
      event.stopPropagation(); row.current = event.currentTarget.closest('.assessment-link,.assessment-summary');
      setAudience('course'); setError(''); setOpen(true);
    }}>{t("Publish quiz")}</button>
    {!exam.question_count && <p className="muted publish-quiz-hint">{t("Add questions before publishing.")}</p>}
    {open && <div onClick={event => event.stopPropagation()} onChange={event => event.stopPropagation()} onSubmit={event => {event.preventDefault(); event.stopPropagation();}}>
      <Modal title={t('Publish quiz')} onClose={() => setOpen(false)} closeDisabled={busy}>
        <div className="modal-form">
          {exam.audience === 'all' && <fieldset disabled={busy} className="publish-audience">
            <legend>{t('Audience')}</legend>
            <div className="publish-option"><label><input type="radio" name={`publish-audience-${exam.id}`} checked={audience === 'course'} onChange={() => setAudience('course')}/>{t('Only participants of the linked course')}</label>
            <p className="field-hint">{t('Approved participants of its linked courses, plus anyone you assign or invite.')}</p></div>
            <div className="publish-option"><label><input type="radio" name={`publish-audience-${exam.id}`} checked={audience === 'all'} onChange={() => setAudience('all')}/>{t('Everyone with an account')}</label>
            <p className="field-hint">{t('Anyone who can sign in can take it, not only course participants.')}</p></div>
          </fieldset>}
          <p>{message}</p>
          {courseUnpublished && <p>{t('Participants can take it after the course is published.')}</p>}
          <ErrorBox message={error}/>
          <div className="modal-footer"><button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>{t('Cancel')}</button><button type="button" className="btn primary" disabled={busy} onClick={() => void publish()}>{t('Publish quiz')}</button></div>
        </div>
      </Modal>
    </div>}
  </>;
}

export default function AssessmentBlock({course, onNavigate, variant = "full", onManage, onChanged}: {
  course: Course; onNavigate?: (path: string) => void; variant?: "full" | "compact" | "learner"; onManage?: () => void; onChanged?: () => void | Promise<unknown>;
}) {
  const all = course.assessments || [];
  const manager = variant === "full" && course.can_manage;
  const rows = all.filter(e => manager || e.available_to_me);
  const summary = variant === "compact" && course.can_manage && all.length > 0;
  if (!rows.length && !summary) return null;
  return <section className={`course-assessment-block assessment-${variant}`} aria-label={t("Course assessment")} onClick={event => {
    const link = (event.target as HTMLElement).closest("a");
    if (link && onNavigate) {event.preventDefault(); onNavigate(link.getAttribute("href")!);}
  }}>
    {summary ? <div className="heading-actions assessment-compact-heading">
      <strong>{t("Course assessment")} <span className="count">{all.length}</span></strong>
      {!all.some(e => e.published) && <Badge tone="neutral">{t("Not published yet")}</Badge>}
      <button className="text-btn" type="button" onClick={onManage}>{t("Manage quizzes")}</button>
    </div> : variant === "full" && <h3>{t("Course assessment")} {manager && !rows.some(e => e.published) && <Badge tone="neutral">{t("Draft")}</Badge>}</h3>}
    {rows.map(exam => <div className="assessment-summary" key={exam.id}>
      <strong>{exam.title}</strong>
      {manager && <>
        <Badge tone={exam.published ? "teal" : "neutral"}>{t(exam.published ? "Published" : "Draft")}</Badge>
        <InvitationOnlyNotice exam={exam}/>
                {exam.audience !== "invitation" && !exam.published && !exam.can_manage && <p className="muted">{t("Ask the exam owner to publish.")}</p>}
        {(exam.can_manage || (exam.published && exam.audience !== "invitation")) && <div className="heading-actions">
          {!exam.published && exam.can_manage && exam.audience !== 'invitation' && onChanged
            ? <PublishQuiz exam={exam} onChanged={onChanged}/>
            : <a className="btn" href={appPath(`/exams?exam=${exam.id}${exam.can_manage ? '&action=preview' : ''}`)}>{t('Open')}</a>}
          <ActionMenu title={exam.title}>
            <div data-keep-menu><ParticipantLink exam={exam}/></div>
            {exam.can_manage && <>
              <a href={appPath(`/exams?exam=${exam.id}&action=preview`)}>{t('Preview exam')}</a>
              <a href={appPath(`/exams?exam=${exam.id}&action=edit`)}>{t('Edit quiz')}</a>
            </>}
            {exam.available_to_me && <ExamLearnerActions exam={exam} showWindow={false}/>}
          </ActionMenu>
        </div>}
        <AssessmentWindow exam={exam}/>
      </>}
      {exam.available_to_me && <RetryNotice value={exam}/>}
      {!manager && exam.available_to_me && <div className="heading-actions assessment-learner-actions"><ExamLearnerActions exam={exam} showWindow={!manager} secondary={variant !== "compact"}/></div>}
    </div>)}
  </section>;
}
