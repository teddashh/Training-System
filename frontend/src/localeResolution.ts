export type Locale = 'en' | 'zh-TW' | 'es';
export const allLocales: Locale[] = ['en', 'zh-TW', 'es'];
export function allowedLocales(value: unknown): Locale[] {
  const list = Array.isArray(value) ? value.filter((code): code is Locale => allLocales.includes(code)) : allLocales;
  return list.length ? [...new Set(list)] : ['en'];
}
export function resolveLocale(current: string | null, allowed: Locale[]): Locale {
  return allowed.includes(current as Locale) ? current as Locale : allowed[0];
}
