import ActionMenu from "./ActionMenu";
import { AssessmentWindow, InvitationOnlyNotice, ParticipantLink, PublishQuiz } from "./AssessmentBlock";
import { appPath } from "./paths";
import { useEffect, useState } from "react";
import { ExamEditor } from "./Exams";
import { api } from "./api";
import { t } from "./i18n";
import { Badge, ErrorBox } from "./ui";
import { useAccess } from "./access";
import type { Course, Exam } from "./types";

type Option = Pick<Exam, "audience" | "id" | "title" | "published" | "question_count" | "can_manage" | "starts_at" | "ends_at"> & {other_courses: number};
type Options = { linked: Option[]; available: Option[] };

export default function CourseAssessments({ course, onSaved }: { course: Course; onSaved: () => void }) {
  const access = useAccess();
  const [options, setOptions] = useState<Options>({ linked: [], available: [] });
  const [exams, setExams] = useState<Exam[]>([]);
  const [editing, setEditing] = useState<Exam | null | undefined>();
  const [chosen, setChosen] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setOptions(await api<Options>(`courses/${course.id}/assessments/`));
    if (access.exams !== "none") setExams(await api<Exam[]>("exams/"));
  }
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [course.id]);
  async function link(exam: number, attach: boolean) {
    setBusy(true); setError("");
    try {
      setOptions(await api<Options>(`courses/${course.id}/assessments/`, "POST", { exam, attach }));
      setChosen(""); onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="form-section course-assessments">
    <h3>{t("Course assessment")}</h3>

    <p className="muted">{t("Approved learners can take published quizzes unless invitation-only.")}</p>
    {options.linked.map(option => {
      const exam = exams.find(e => e.id === option.id && e.can_manage);
      return <div className="assessment-link" key={option.id}>
        <strong>{option.title}</strong><Badge tone={option.published ? "teal" : "neutral"}>{t(option.published ? "Published" : "Draft")}</Badge>
        <InvitationOnlyNotice exam={option}/>
                {option.audience !== "invitation" && !option.published && !option.can_manage && <p className="muted">{t("Ask the exam owner to publish.")}</p>}
        <AssessmentWindow exam={option}/>
        {!option.published && option.can_manage && option.audience !== 'invitation'
          ? <PublishQuiz exam={option} courseUnpublished={!course.published} onChanged={async () => {await refresh(); onSaved();}}/>
          : <a className="btn" href={appPath(`/exams?exam=${option.id}${option.can_manage ? '&action=preview' : ''}`)}>{t('Open')}</a>}
        <ActionMenu title={option.title}>
          <div data-keep-menu><ParticipantLink exam={option}/></div>
          {option.can_manage && <a href={appPath(`/exams?exam=${option.id}&action=preview`)}>{t('Preview exam')}</a>}
          {exam && <button type="button" onClick={() => setEditing(exam)}>{t('Edit quiz')}</button>}
          <button type="button" disabled={busy} onClick={() => void link(option.id, false)}>{t('Detach quiz')}</button>
        </ActionMenu>
      </div>;
    })}
    <div className="heading-actions">
      {access.exams !== "none" && <button type="button" className="btn" onClick={() => setEditing(null)}>{t("Create quiz")}</button>}
      {options.available.length > 0 && <>
        <select aria-label={t("Existing quiz")} value={chosen} onChange={e => setChosen(e.target.value)}>
          <option value="">{t("Choose existing quiz")}</option>
          {options.available.map(e => <option key={e.id} value={e.id}>{e.title} · {t(e.published ? "Published" : "Draft")} · {t("{count} questions", { count: e.question_count })}{e.other_courses ? ` · ${t("Also used by {count} courses", {count: e.other_courses})}` : ""}{e.audience === "invitation" ? ` · ${t("Invitation only")}` : ""}</option>)}
        </select>
        <button className="btn" type="button" disabled={!chosen || busy} onClick={() => void link(Number(chosen), true)}>{t("Attach quiz")}</button>
      </>}
    </div><ErrorBox message={error} />
    {editing !== undefined && <ExamEditor exam={editing} initialCourseId={course.id} courses={[course]} onClose={() => setEditing(undefined)} onSaved={() => { void refresh().catch(e => setError(e.message)); onSaved(); }} />}
  </section>;
}
