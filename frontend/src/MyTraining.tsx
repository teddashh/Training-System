import { MapPin } from "lucide-react";
import { formatDate, formatTimeRange, zoneName } from "./datetime";
import AddToCalendar from "./AddToCalendar";
import { useEffect, useState } from "react";
import { api } from "./api";
import { t, useLocale } from "./i18n";
import type { Course } from "./types";
import { Badge, Empty, ErrorBox, Spinner } from "./ui";
import { CourseArtwork } from "./CourseCover";
import { SessionEnrollment } from "./CourseSessions";
import AssessmentBlock from "./AssessmentBlock";
import { appPath } from "./paths";

export default function MyTraining({refreshKey, onSaved, go}: {refreshKey: number; onSaved: () => void; go: (path: string) => void}) {
  const locale = useLocale();
  const [courses, setCourses] = useState<Course[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [session, setSession] = useState<Course | null>(null);
  useEffect(() => {
    let alive = true;
    api<Course[]>("courses/mine/").then(rows => {if (alive) {setCourses(rows.filter(course => course.published)); setError("");}}).catch(e => {if (alive) setError(e.message);}).finally(() => {if (alive) setLoading(false);});
    return () => {alive = false;};
  }, [refreshKey]);
  const group = (c: Course) => c.enrollment?.completed_at || c.progress === 100 ? "Completed" : c.enrollment?.session && Date.parse(c.enrollment.session.ends_at) > Date.now() ? "Upcoming sessions" : "Course in progress";
  return <>
    <div className="page-heading"><h1>{t("My training")}</h1></div>
    <ErrorBox message={error}/>
    {loading ? <Spinner/> : !courses.length ? <div className="panel"><Empty title={t("No training yet")} /><a className="btn" href={appPath("/courses")}>{t("Catalog")}</a></div> :
      ["Upcoming sessions", "Course in progress", "Completed"].map(label => {
        const rows = courses.filter(c => group(c) === label);
        return rows.length > 0 && <section key={label} className="personal-section"><h2>{t(label)}</h2>{label === "Upcoming sessions" && <p className="muted personal-section-caption">{t("Times shown in {zone}", {zone: zoneName(locale)})}</p>}<div className="course-grid">
          {rows.map(c => {
            const ownSession = c.sessions.find(s => s.id === c.enrollment?.session?.id) || c.enrollment?.session;
            const running = ownSession && !ownSession.cancelled && Date.parse(ownSession.starts_at) <= Date.now() && Date.parse(ownSession.ends_at) > Date.now();
            const status = ownSession?.cancelled ? "Session cancelled" : c.enrollment?.status === "pending" ? "Pending approval" : label === "Completed" ? "Completed" : running ? "In progress" : ownSession && Date.parse(ownSession.starts_at) > Date.now() ? "Registered" : c.progress_known !== false && c.progress !== null && c.progress > 0 ? "Course in progress" : "Not started";
            return <article className="course-card" key={c.id}>
              <CourseArtwork cover={c.cover} title={c.title} heading/>
              <div className="course-body">
                <Badge tone={ownSession?.cancelled ? "amber" : status === "Completed" ? "teal" : "neutral"}>{t(status)}</Badge>
                {ownSession && <><p><strong>{ownSession.title}</strong></p><p>{formatDate(ownSession.starts_at, locale)} · {formatTimeRange(ownSession.starts_at, ownSession.ends_at, locale)}</p>{ownSession.location && <p className="session-location"><MapPin size={16} aria-hidden="true"/><span>{t('Location')}: {ownSession.location}</span></p>}</>}
                {!c.published && <p className="muted">{t("Training is currently unavailable.")}</p>}
                <div className="course-actions">
                  {running && c.can_learn && <button type="button" className="btn primary" onClick={() => go(`/courses?course=${c.id}&action=learn&from=my-training`)}>{t("Start learning")}</button>}
                  {c.delivery_mode === "scheduled" ? <button type="button" className={`btn${ownSession?.cancelled ? " primary" : ""}`} onClick={() => setSession(c)}>{t(ownSession?.cancelled ? "Choose another session" : "View sessions")}</button> : <button className="btn" disabled={!c.published} onClick={() => go(`/courses?course=${c.id}&from=my-training`)}>{t(c.progress !== null && c.progress < 100 ? "Continue" : "Open")}</button>}
                  <AddToCalendar course={c}/>
                </div>
                <AssessmentBlock course={c} variant="learner"/>
              </div>
            </article>;
          })}
        </div></section>;
      })}
    {session && <SessionEnrollment course={session} onClose={() => setSession(null)} onSaved={onSaved} onReady={c => go(`/courses?course=${c.id}&action=learn&from=my-training`)}/>}
  </>;
}
