import { useState, type ReactNode } from "react";
import { Check, Search } from "lucide-react";
import covers from "../../shared/brand/covers.json";
import { brand } from "./brand";
import { appPath } from "./paths";
import { t } from "./i18n";
import { Modal } from "./ui";

export const DEFAULT_COVER = "scene-learning-classroom";

export function suggestCover(title: string): string {
  const query = title.toLowerCase();
  return covers.find(c => c.id.startsWith("scene-") && c.keywords?.some(keyword => query.includes(keyword)))?.id || DEFAULT_COVER;
}

export function coverUrl(id: string) {
  const cover = covers.find(c => c.id === id) || covers.find(c => c.id === DEFAULT_COVER)!;
  // Invalidate the earlier assets that embedded the company logo.
  return appPath(`/covers/${cover.id}.svg?v=2`);
}
export function CourseArtwork({ cover, title, heading = false, children }: {
  cover: string; title: string; heading?: boolean | "h1" | "h2" | "h3"; children?: ReactNode;
}) {
  const Title = typeof heading === "string" ? heading : heading ? "h2" : "p";
  const label = title.trim() || t("Course title");
  return <div className="course-cover">
    <img className="course-cover-image" src={coverUrl(cover)} alt="" loading="lazy" />
    <img className={"course-cover-logo" + (brand.uploadedLogo ? " uploaded-logo" : "")} src={brand.horizontalLogo} alt="" />
    <div className="course-cover-caption"><Title className="course-cover-title" title={label}>{label}</Title></div>
    {children}
  </div>;
}
export default function CourseCover({ value, title, onChange, compact = false }: { compact?: boolean; value: string; title: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [category, setCategory] = useState("");
  const selected = covers.find(c => c.id === value) || covers.find(c => c.id === DEFAULT_COVER)!;
  const search = query.trim().toLowerCase();
  const filtered = covers.filter(c => {
    const matches = `${c.title} ${t(c.title)} ${c.category} ${t(c.category)} ${(c.keywords || []).join(" ")}`.toLowerCase().includes(search);
    return matches && (category ? c.category === category : c.category !== "Patterns" || Boolean(search));
  });
  return <section className={compact ? "training-cover-field" : "course-cover-field"}>
    {compact ? <img src={coverUrl(value)} alt="" /> : <CourseArtwork cover={value} title={title} />}
    <div>{!compact && <><h3>{t("Course cover")}</h3><p>{t(selected.title)}</p></>}<button type="button" className="btn" onClick={() => { setQuery(""); setCategory(""); setOpen(true); }}>{t(compact ? "Change" : "Choose cover")}</button></div>
    {open && <Modal title={t("Choose cover")} wide onClose={() => setOpen(false)} className="cover-library">
      <div className="modal-form">
        <div className="toolbar"><div className="search-field"><Search size={16} /><input aria-label={t("Search covers")} placeholder={t("Search covers")} value={query} onChange={e => setQuery(e.target.value)} /></div>
          <select aria-label={t("Cover theme")} value={category} onChange={e => setCategory(e.target.value)}><option value="">{t("All themes")}</option>{[...new Set(covers.map(c => c.category))].map(c => <option key={c} value={c}>{t(c)}</option>)}</select>
        </div>
        <p className="muted" role="status">{t("{count} covers", {count: filtered.length})}</p>
        <div className="cover-library-grid">{filtered.map(c => <button type="button" key={c.id} aria-label={t(c.title)} aria-pressed={c.id === selected.id} onClick={() => { onChange(c.id); setOpen(false); }}>
          <img src={coverUrl(c.id)} alt="" loading="lazy" /><span>{t(c.title)}{c.id === selected.id && <Check size={16} />}</span>
        </button>)}</div>
        {!filtered.length && <p>{t("No matching covers")}</p>}
      </div>
    </Modal>}
  </section>;
}
