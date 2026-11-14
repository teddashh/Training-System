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
import { nextSessionDelay } from "./sessionBoundary";
import { courseProgressLabels } from "./courseProgress";

export default function MyTraining({refreshKey, onSaved, go}: {refreshKey: number; onSaved: () => void; go: (path: string) => void}) {
  const locale = useLocale();
  const [courses, setCourses] = useState<Course[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [session, setSession] = useState<Course | null>(null);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>;
    const fetchCourses = () => {
      api<Course[]>("courses/mine/").then(rows => {if (alive) {
        const published = rows.filter(course => course.published); setCourses(published); setError("");
        const delay = nextSessionDelay(published, Date.now());
        if (delay !== null) timer = setTimeout(fetchCourses, delay);
      }}).catch(e => {if (alive) setError(e.message);}).finally(() => {if (alive) setLoading(false);});
    };
    fetchCourses();
    return () => {alive = false; clearTimeout(timer);};
  }, [refreshKey]);
  const group = (c: Course) => c.enrollment?.completed_at || c.progress === 100 ? "Completed" : c.enrollment?.session && Date.parse(c.enrollment.session.ends_at) > Date.now() ? "Upcoming sessions" : "Course in progress";
  return <>
    <div className="page-heading"><h1>{t("My Training")}</h1></div>
    <ErrorBox message={error}/>
    {loading ? <Spinner/> : !courses.length ? <div className="panel"><Empty title={t("No training yet")} description=""/></div> :
      ["Upcoming sessions", "Course in progress", "Completed"].map(label => {
        const rows = courses.filter(c => group(c) === label);
        return rows.length > 0 && <section key={label} className="personal-section"><h2>{t(label)}</h2>{label === "Upcoming sessions" && <p className="muted personal-section-caption">{t("Times shown in {zone}", {zone: zoneName(locale)})}</p>}<div className="course-grid">
          {rows.map(c => {
            const ownSession = c.sessions.find(s => s.id === c.enrollment?.session?.id) || c.enrollment?.session;
            const running = ownSession && !ownSession.cancelled && Date.parse(ownSession.starts_at) <= Date.now() && Date.parse(ownSession.ends_at) > Date.now();
            const progressLabels = courseProgressLabels(c);
            const status = ownSession?.cancelled ? "Session cancelled" : c.enrollment?.status === "pending" ? "Pending approval" : label === "Completed" ? "Completed" : running ? "In progress" : ownSession && Date.parse(ownSession.starts_at) > Date.now() ? "Registered" : progressLabels.status;
            return <article className="course-card" key={c.id}>
              <CourseArtwork cover={c.cover} title={c.title} heading/>
              <div className="course-body">
                <Badge tone={ownSession?.cancelled ? "amber" : status === "Completed" ? "teal" : "neutral"}>{t(status)}</Badge>
                {ownSession && <><p><strong>{ownSession.title}</strong></p><p>{formatDate(ownSession.starts_at, locale)} · {formatTimeRange(ownSession.starts_at, ownSession.ends_at, locale)}</p>{ownSession.location && <p className="session-location"><MapPin size={16} aria-hidden="true"/><span>{t('Location')}: {ownSession.location}</span></p>}</>}
                {!c.published && <p className="muted">{t("Training is currently unavailable.")}</p>}
                <div className="course-actions">
                  {running && c.can_learn && <button type="button" className="btn primary" onClick={() => go(`/courses?course=${c.id}&action=learn&from=my-training`)}>{t("Start learning")}</button>}
                  {c.delivery_mode === "scheduled" ? <button type="button" className={`btn${ownSession?.cancelled ? " primary" : ""}`} onClick={() => setSession(c)}>{t(ownSession?.cancelled ? "Choose another session" : "View sessions")}</button> : <button className="btn" disabled={!c.published} onClick={() => go(`/courses?course=${c.id}&from=my-training`)}>{t(progressLabels.action)}</button>}
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
