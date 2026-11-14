import { t, getLocale } from "./i18n";
import { readBody } from "./responseBody";
import { noteArrival } from "./serverClock";
import { appPath } from "./paths";
import { fileNameFrom } from "./fileName";

/** `fetch` whose failure reads as a sentence: browsers report a lost connection or a timeout as "Failed to fetch" or "Load failed". */
export async function request(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (reason) {
    throw unreachable(reason);
  }
}
/** The same sentence for an answer that began to arrive and was cut off. */
export const unreachable = (reason: unknown) =>
  new Error(t('The server could not be reached. Check your connection and try again.'), { cause: reason });

/** Download an authenticated, localized attachment using the server's file name. */
export async function downloadFile(path: string, fallback: string) {
  const response = await request(appPath('/api/' + path), {
    credentials: 'same-origin',
    headers: { 'Accept-Language': getLocale() === 'zh-TW' ? 'zh-hant' : getLocale() },
  });
  if (!response.ok) {
    const body = await readBody(response, unreachable);
    throw new Error(typeof body.detail === 'string' ? body.detail : Array.isArray(body) ? body.join('; ') : t('The operation could not be completed. Please try again.'));
  }
  const file = await response.blob().catch((reason) => { throw unreachable(reason); });
  const url = URL.createObjectURL(file), link = document.createElement('a');
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
  const response = await request(appPath("/api/" + path), {
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
  // A cut-off answer must not pass for an empty one: a save would count as done with nothing to show for it.
  const body = await readBody(response, unreachable);
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
  noteArrival(body);
  return body;
}
