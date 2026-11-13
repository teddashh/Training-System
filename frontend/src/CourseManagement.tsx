import { useState } from "react";
import { Download, Eye, Pencil, Send, Settings, Upload, UserPlus, Users } from "lucide-react";
import { useAccess } from "./access";
import { api } from "./api";
import { appPath } from "./paths";
import { t, useLocale } from "./i18n";
import { Badge, ErrorBox } from "./ui";
import { coverUrl } from "./CourseCover";
import ActionMenu from "./ActionMenu";
import { CancelTraining, DeleteTraining } from "./TrainingLifecycle";
import { nextSession, shortWhen } from "./simpleTraining";
import type { Course } from "./types";

/** Every scheduled training has its own page, including drafts without sessions. */
export const opensTrainingPage = (course: Course) => course.delivery_mode === "scheduled";

export default function CourseManagement({ course, onOpen, onSettings, onEnrollments, onUpload, onSaved }: {
  course: Course;
  onOpen: () => void;
  onSaved: () => void;
  onSettings: () => void;
  onEnrollments: () => void;
  onUpload: () => void;
}) {
  const locale = useLocale();
  const access = useAccess();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const hasContent = !!course.package || course.blocks.some(block => block.text.trim());
  const editable = course.venue !== "onsite" && access.scorm_source && (!course.package || course.package.has_source);
  const native = course.venue !== "onsite" && !course.package && hasContent;
  const scheduled = course.published && !!course.release_at && Date.parse(course.release_at) > Date.now();
  const state = !course.published ? "Draft" : scheduled ? "Scheduled" : "";
  const next = nextSession(course);
  const publishable = course.venue === "onsite" || hasContent;
  async function publish() {
    setBusy(true); setError("");
    try { await api(`courses/${course.id}/`, "PATCH", { published: true }); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const href = appPath(opensTrainingPage(course) ? `/authoring/${course.id}` : `/authoring?course=${course.id}&action=edit`);
  return <article className="training-row">
    <img className="training-thumb" src={coverUrl(course.cover)} alt="" loading="lazy" />
    <div className="training-row-info">
      <h2><a href={href} onClick={event => { event.preventDefault(); onOpen(); }}>{course.title}</a></h2>
      <p>{state && <Badge tone={course.published ? "neutral" : "amber"}>{t(state)}</Badge>}{next && <span>{shortWhen(next.starts_at, locale)}</span>}<span>{t("{count} registered", { count: course.enrolled_count })}</span></p>
      <ErrorBox message={error} />
    </div>
    <ActionMenu title={course.title}>
      {native ? <button type="button" onClick={onSettings} aria-label={t("Edit {title} content", { title: course.title })}><Pencil size={16} />{t("Edit content")}</button>
        : editable ? <a href={appPath(`/studio/?course=${course.id}#/app`)} aria-label={t("Edit {title} content", { title: course.title })}><Pencil size={16} />{t(hasContent ? "Edit content" : "Add content")}</a>
        : course.venue !== "onsite" && access.scorm_upload ? <button type="button" onClick={onUpload}><Upload size={16} />{t("Replace content")}</button> : null}
      {course.venue !== "onsite" && <a href={appPath(`/courses?course=${course.id}&action=preview`)}><Eye size={16} />{t("Preview content")}</a>}
      {!course.published && <button type="button" disabled={busy || !publishable} title={!publishable ? t("Add content before publishing") : undefined} onClick={() => void publish()}><Send size={16} />{t(course.release_at && Date.parse(course.release_at) > Date.now() ? "Schedule release" : "Publish course")}</button>}
      <button type="button" onClick={onSettings}><Settings size={16} />{t("Course settings")}</button>
      {!opensTrainingPage(course) && course.published && access.assign && <a href={appPath(`/assignments?action=assign&course=${course.id}&report=1`)}><UserPlus size={16} />{t("Assign training")}</a>}
      <button type="button" disabled={!opensTrainingPage(course) && !course.published} onClick={onEnrollments}><Users size={16} />{t("People")}</button>
      {native && access.scorm_upload && <a href={appPath(`/studio/?course=${course.id}#/app`)}><Pencil size={16} />{t("Open in Studio")}</a>}
      {course.venue !== "onsite" && access.scorm_upload && <button type="button" onClick={onUpload}><Upload size={16} />{t("Upload SCORM")}</button>}
      {access.scorm_source && course.package?.has_source && <a href={appPath(`/api/courses/${course.id}/source/`)}><Download size={16} />{t("Content backup")}</a>}
      <CancelTraining course={course} onSaved={onSaved} />
      <DeleteTraining kind="course" target={course} onDeleted={onSaved} />
    </ActionMenu>
  </article>;
}
