import { useEffect, useState } from "react";
import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { api } from "./api";
import { appPath } from "./paths";
import { t, useLocale } from "./i18n";
import { Badge, ErrorBox, Spinner } from "./ui";
import Activity, { type ActivityEntry } from "./Activity";

type Overview = {
  courses: { total: number; published: number };
  exams: { total: number; published: number };
  people: { total: number; active: number };
  pending_enrollments: number;
  pending_reviews: number;
  enrollment_requests: { course_id: number; course__title: string; count: number }[];
  drafts: { kind: "course" | "exam"; id: number; title: string }[];
  activity: ActivityEntry[];
};

export default function Administration({ go }: { go: (path: string) => void }) {
  const locale = useLocale();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setError("");
    api<Overview>("administration/")
      .then(value => { if (alive) setData(value); })
      .catch(value => { if (alive) setError(value.message); });
    return () => { alive = false; };
  }, [locale, reload]);
  const link = (path: string, label: string, className = "text-btn") => <a
    className={className} href={appPath(path)}
    onClick={event => { event.preventDefault(); go(path); }}
  >{label}<ArrowRight size={16} /></a>;
  const workflows = [
    { title: t("Courses & content"), path: "/authoring", action: t("Manage courses"),
      description: t("Write lessons, upload course packages and control publication."),
      count: data ? t("{count} published", { count: data.courses.published }) : "" },
    { title: t("Exams"), path: "/exams", action: t("Manage exams"),
      description: t("Build questions, set audiences and choose attempt limits."),
      count: data ? t("{count} published", { count: data.exams.published }) : "" },
    { title: t("Assigned training"), path: "/assignments?report=1", action: t("Manage assignments"),
      description: t("Assign a course or exam to people and set a due date."),
      count: "" },
    { title: t("Results"), path: "/results", action: t("Review results"),
      description: t("Review answers, release grades and export training evidence."),
      count: data ? t("{count} awaiting review", { count: data.pending_reviews }) : "" },
  ];
  return <div className="administration-page">
    <div className="page-heading">
      <div>
        <h1>{t("Management center")}</h1>

      </div>
      <div className="heading-actions">
        {link("/courses", t("Open course catalog"), "btn")}
        <button className="btn primary" onClick={() => go("/authoring?action=create")}><Plus size={17} />{t("Create course")}</button>
      </div>
    </div>
    <ErrorBox message={error} />
    {error && <button className="btn small" onClick={() => setReload(value => value + 1)}><RefreshCw size={16} />{t("Try again")}</button>}
    {!data && !error ? <Spinner /> : data && <>
      <section className="panel management-summary" aria-label={t("Training at a glance")}>
        {[
          { count: data.courses.total, label: t("Courses"), detail: t("{count} drafts", { count: data.courses.total - data.courses.published }), path: "/authoring" },
          { count: data.exams.total, label: t("Exams"), detail: t("{count} drafts", { count: data.exams.total - data.exams.published }), path: "/exams" },
          { count: data.people.active, label: t("Active people"), detail: t("Manage access and roles"), path: "/people" },
          { count: data.pending_enrollments, label: t("Enrollment requests"), detail: t("Review course access below"), path: "#management-attention" },
        ].map(item => <a key={item.label} href={item.path.startsWith("#") ? item.path : appPath(item.path)} onClick={event => {
          if (!item.path.startsWith("#")) { event.preventDefault(); go(item.path); }
        }}><strong>{item.count}</strong><span>{item.label}</span><small>{item.detail}</small></a>)}
      </section>
      {!data.courses.total && !data.exams.total && <div className="management-welcome">
        <strong>{t("Create course")}</strong>
        <p>{t("Create a course, add content, then publish it.")}</p>
      </div>}
      <div className="management-columns">
        <div>
          <section className="panel management-workflows" aria-labelledby="management-workflow-heading">
            <div className="management-section-heading"><h2 id="management-workflow-heading">{t("Training tasks")}</h2></div>
            {workflows.map((item, index) => <div className="management-workflow" key={item.path}>
              <span className="workflow-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div><h3>{item.title}</h3><p>{item.description}</p>
                <div className="workflow-actions">{link(item.path, item.action)}{item.count && <span>{item.count}</span>}</div>
              </div>
            </div>)}
          </section>
          <section className="panel management-drafts" aria-labelledby="management-drafts-heading">
            <div className="management-section-heading"><h2 id="management-drafts-heading">{t("Continue preparing")}</h2><p>{t("Drafts stay out of the learner catalog until you publish them.")}</p></div>
            {data.drafts.length ? <ul className="management-records">
              {data.drafts.map(item => <li key={item.kind + item.id}>
                <div><Badge tone="neutral">{item.kind === "course" ? t("Course") : t("Exam")}</Badge><strong>{item.title}</strong></div>
                {link(item.kind === "course" ? `/authoring?course=${item.id}&action=edit` : `/exams?exam=${item.id}&action=edit`, t("Continue editing"), "btn small")}
              </li>)}
            </ul> : <p className="management-empty">{t("No drafts.")}</p>}
          </section>
        </div>
        <aside className="management-aside">
          <section className="panel management-attention" id="management-attention" aria-labelledby="management-attention-heading">
            <div className="management-section-heading"><h2 id="management-attention-heading">{t("Needs your attention")}</h2></div>
            {data.pending_reviews > 0 && <div className="management-attention-item"><strong>{t("{count} exams awaiting review", { count: data.pending_reviews })}</strong>{link("/results?status=pending_review", t("Review answers"))}</div>}
            {data.enrollment_requests.map(item => <div className="management-attention-item" key={item.course_id}>
              <strong>{item.course__title}</strong><p>{t("{count} enrollment requests", { count: item.count })}</p>
              {link(`/authoring?course=${item.course_id}&action=enrollments`, t("Review requests"))}
            </div>)}
            {!data.pending_reviews && !data.pending_enrollments && <p className="management-empty">{t("No enrollment requests or exam reviews are waiting.")}</p>}
          </section>
          <section className="panel management-access" aria-labelledby="management-access-heading">
            <div className="management-section-heading"><h2 id="management-access-heading">{t("People & access")}</h2></div>
            {[
              ["/people", t("People"), t("Add people, update roles and manage account access.")],
              ["/invitations", t("Guest exam invitations"), t("Give external participants a personal exam link.")],
              ["/question-bank", t("Question bank"), t("Reuse questions across your assessments.")],
              ["/settings", t("Settings"), t("Review sign-in configuration and recent changes.")],
              ["/email", t("Email"), t("Review delivery status and retry failed notifications.")],
            ].map(([path, title, description]) => <div key={path} className="management-access-item">{link(path, title)}<p>{description}</p></div>)}
          </section>
          <section className="panel management-recent" aria-labelledby="management-recent-heading">
            <div className="management-section-heading"><h2 id="management-recent-heading">{t("Recent activity")}</h2></div>
            <Activity rows={data.activity.slice(0, 4)} go={go} compact />
            <div className="management-panel-footer">{link("/settings", t("View activity history"))}</div>
          </section>
        </aside>
      </div>
    </>}
  </div>;
}
