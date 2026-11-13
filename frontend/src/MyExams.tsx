import { formatDateTime } from "./datetime";
import type { Exam } from "./types";
import { countLabel, t, useLocale } from "./i18n";
import { Badge, Empty } from "./ui";
import { ExamLearnerActions } from "./AssessmentBlock";
import { examLearnerState } from "./examLearnerState";
import { RetryNotice } from "./RetryAvailability";

export default function MyExams({exams}: {exams: Exam[]}) {
  const locale = useLocale();
  const available = exams.filter(e => e.available_to_me);
  return <>
    <div className="page-heading"><h1>{t("My exams")}</h1></div>
    {!available.length && <Empty title={t("No exams available")} />}
    {["To do", "Completed", "Closed"].map(label => {
      const rows = available.filter(e => examLearnerState(e).group === label);
      return rows.length > 0 && <section className="personal-section" key={label}><h2>{t(label)}</h2><div className="exam-list">
        {rows.map(exam => <article className="exam-card" key={exam.id}>
          <div className="exam-main">
            <h3>{exam.title}</h3>
            {exam.course_links.length > 0 && <p>{exam.course_links.map(c => c.title).join(" · ")}</p>}
            <p className="muted">{countLabel(exam.question_count, '{count} question', '{count} questions')} · {countLabel(exam.duration_minutes, '{count} minute', '{count} minutes')} · {t('Passing score')}: {exam.pass_score} · {countLabel(exam.attempts_remaining, "{count} attempt remaining", "{count} attempts remaining")}</p>
            {exam.assignment_due_at && <p>{t("Due {time}", {time: formatDateTime(exam.assignment_due_at, locale, {zone: true})})}</p>}
            {exam.last_result?.score !== null && exam.last_result?.score !== undefined && <p>{t("Last score: {score}", {score: exam.last_result.score})} {exam.last_result.passed !== null && <Badge tone={exam.last_result.passed ? "teal" : "amber"}>{t(exam.last_result.passed ? "Passed" : "Not passed")}</Badge>}</p>}
            <RetryNotice value={exam}/>
          </div>
          <div className="exam-actions">
            <ExamLearnerActions exam={exam} personal/>
          </div>
        </article>)}
      </div></section>;
    })}
  </>;
}
