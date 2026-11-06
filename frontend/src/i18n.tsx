import { useSyncExternalStore } from "react";
import { Languages } from "lucide-react";
import messages from "../../shared/locales/messages.json";

export type Locale = "en" | "zh-TW" | "es";
export const locales: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "es", label: "Español" },
];
const valid = (value: string | null): value is Locale =>
  locales.some((l) => l.value === value);
const storageKey = "training-language";
let locale: Locale = "en";
try {
  const saved = localStorage.getItem(storageKey);
  if (valid(saved)) locale = saved;
} catch {
  /* Private browsers can restrict persistent storage. */
}
const listeners = new Set<() => void>();
export const getLocale = () => locale;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useLocale = () =>
  useSyncExternalStore(subscribe, getLocale, () => "en" as Locale);
export function t(key: string, values: Record<string, string | number> = {}) {
  const entry = (messages as Record<string, Record<Locale, string>>)[key];
  const template = entry?.[locale] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}
function applyDocumentLocale() {
  document.documentElement.lang = locale;
  document.title = "Evitina Learn · " + t("Enterprise learning platform");
  document.cookie = `django_language=${locale === "zh-TW" ? "zh-hant" : locale}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}
export function setLocale(next: Locale) {
  locale = next;
  try {
    localStorage.setItem(storageKey, next);
  } catch {
    /* Keep the in-memory preference. */
  }
  applyDocumentLocale();
  listeners.forEach((listener) => listener());
}
window.addEventListener("storage", (event) => {
  if (event.key === storageKey && valid(event.newValue))
    setLocale(event.newValue);
});
applyDocumentLocale();
export function LanguagePicker() {
  const language = useLocale();
  return (
    <label className="language-picker">
      <Languages size={17} aria-hidden="true" />
      <select
        aria-label={t("Interface language")}
        value={language}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {locales.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
