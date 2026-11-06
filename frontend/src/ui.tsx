import { t, useLocale, getLocale, LanguagePicker } from "./i18n";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import {
  X,
  LoaderCircle,
  Inbox,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useLocale();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const focusable = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input,textarea,select,a[href]",
        ) || [],
      );
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key === "Tab") {
        const els = focusable();
        const first = els[0],
          last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-shade"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={"modal " + (wide ? "wide" : "")}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <LanguagePicker />
          <button
            className="icon-btn"
            onClick={onClose}
            aria-label={t("Close")}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Badge({
  children,
  tone = "blue",
}: {
  children: ReactNode;
  tone?: string;
}) {
  useLocale();
  return <span className={"badge " + tone}>{children}</span>;
}
export function Spinner() {
  useLocale();
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={24} />
      <span>{t("Loading data\u2026")}</span>
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  useLocale();
  return message ? (
    <div className="error" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Empty({
  title = t("No data yet"),
  description = t("Create your first record to start your training program."),
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  useLocale();
  return (
    <div className="empty">
      <Inbox size={34} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  useLocale();
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  useLocale();
  return (
    <button className="text-btn" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function date(value: string | null) {
  return value
    ? new Date(value).toLocaleString(getLocale(), {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
export const statusLabel = (): Record<string, string> => ({
  in_progress: t("In progress"),
  pending_review: t("Awaiting manual review"),
  graded: t("Graded"),
});
