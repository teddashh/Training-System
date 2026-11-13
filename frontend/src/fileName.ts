/** The file name a server suggests in Content-Disposition (the RFC 5987 form first), reduced to a safe base name. */
export function fileNameFrom(header: string | null, fallback: string) {
  if (!header) return fallback;
  let name = '';
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try { name = decodeURIComponent(extended[1].trim()); } catch { name = ''; }
  }
  if (!name) {
    const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header);
    name = (plain?.[1]?.replace(/\\(.)/g, '$1') ?? plain?.[2] ?? '').trim();
  }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return name || fallback;
}
