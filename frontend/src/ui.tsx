import { t, useLocale, getLocale, LanguagePicker } from "./i18n";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import {
  X,
  LoaderCircle,
  Inbox,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";
const modalStack: HTMLElement[] = [];
let previousOverflow = "";

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
    const element = panel.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (!modalStack.length) previousOverflow = document.body.style.overflow;
    modalStack.push(element);
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        element.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href],[tabindex]",
        ),
      ).filter(
        (node) =>
          !node.matches(":disabled,[hidden]") &&
          node.tabIndex >= 0 &&
          node.getClientRects().length,
      );
    (focusable()[0] || element).focus();
    const key = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== element) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const els = focusable(),
          first = els[0],
          last = els.at(-1);
        if (!first) {
          event.preventDefault();
          element.focus();
        } else if (
          !element.contains(document.activeElement) ||
          document.activeElement === element
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      const index = modalStack.indexOf(element);
      if (index >= 0) modalStack.splice(index, 1);
      const top = modalStack.at(-1);
      if (!top) document.body.style.overflow = previousOverflow;
      if (previous?.isConnected && (!top || top.contains(previous)))
        previous.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-shade"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={"modal " + (wide ? "wide" : "")}
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <LanguagePicker />
          <button
            className="icon-btn"
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
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
