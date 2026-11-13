import { useSyncExternalStore } from "react";
import { Languages } from "lucide-react";
import messages from "../../shared/locales/messages.json";

import { brand } from "./brand";
import { allowedLocales, resolveLocale, allLocales, type Locale } from "./localeResolution";
export type { Locale } from "./localeResolution";
let allowed = allLocales;
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
export function countLabel(count: number, oneKey: string, otherKey: string) {
  return t(count === 1 ? oneKey : otherKey, {count});
}
export function attemptCount(count: number) {
  return t(count === 1 ? "{count} attempt" : "{count} attempts", { count });
}

function applyDocumentLocale() {
  document.documentElement.lang = locale;
  document.title = brand.customized ? brand.title : t("{organization} · Enterprise learning platform", { organization: brand.organization });
  document.cookie = `django_language=${locale === "zh-TW" ? "zh-hant" : locale}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}
export function setLocale(next: Locale) {
  locale = resolveLocale(next, allowed);
  try {
    localStorage.setItem(storageKey, locale);
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
export function setInterfaceLanguages(value: unknown) {
  allowed = allowedLocales(value);
  setLocale(resolveLocale(locale, allowed));
}
export function LanguagePicker() {
  const language = useLocale();
  if (allowed.length < 2) return null;
  return (
    <label className="language-picker">
      <Languages size={17} aria-hidden="true" />
      <select
        aria-label={t("Interface language")}
        value={language}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {allowed.map(code => locales.find(l => l.value === code)!).map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
