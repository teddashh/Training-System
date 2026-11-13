import { t, getLocale } from "./i18n";
import { appPath } from "./paths";
import { fileNameFrom } from "./fileName";

/** Download an authenticated, localized attachment using the server's file name. */
export async function downloadFile(path: string, fallback: string) {
  const response = await fetch(appPath('/api/' + path), {
    credentials: 'same-origin',
    headers: { 'Accept-Language': getLocale() === 'zh-TW' ? 'zh-hant' : getLocale() },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : Array.isArray(body) ? body.join('; ') : t('The operation could not be completed. Please try again.'));
  }
  const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
  link.href = url;
  link.download = fileNameFrom(response.headers.get('Content-Disposition'), fallback);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public retryAfter?: number,
    public fields?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const csrf =
    document.cookie
      .split("; ")
      .find((v) => /^(?:__Host-)?training_csrf=/.test(v))
      ?.split("=")[1] || "";
  const form = data instanceof FormData;
  const response = await fetch(appPath("/api/" + path), {
    method,
    credentials: "same-origin",
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    headers: {
      "Accept-Language": getLocale() === "zh-TW" ? "zh-hant" : getLocale(),
      ...(!form && data !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(method !== "GET" ? { "X-CSRFToken": decodeURIComponent(csrf) } : {}),
    },
    body: data === undefined ? undefined : form ? data : JSON.stringify(data),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body.detail === "string"
        ? body.detail
        : Array.isArray(body)
          ? body.join("; ")
          : Object.entries(body)
              .map(
                ([k, v]) =>
                  `${k}: ${Array.isArray(v) ? v.join("; ") : JSON.stringify(v)}`,
              )
              .join("; ");
    throw new ApiError(
      message || t("The operation could not be completed. Please try again."),
      response.status,
      body.code,
      Number(response.headers.get("Retry-After")) || undefined,
      body,
    );
  }
  return body;
}
