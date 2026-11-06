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
          <button className="icon-btn" onClick={onClose} aria-label="關閉">
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
  return <span className={"badge " + tone}>{children}</span>;
}
export function Spinner() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={24} />
      <span>正在載入資料…</span>
    </div>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      <AlertCircle size={17} />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Empty({
  title = "尚無資料",
  description = "建立第一筆資料，開始您的訓練計畫。",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
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
  return (
    <button className="text-btn" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function date(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-TW", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
export const statusLabel: Record<string, string> = {
  in_progress: "作答中",
  pending_review: "待人工評分",
  graded: "已評分",
};
