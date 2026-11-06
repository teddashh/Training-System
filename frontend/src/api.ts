import { t, getLocale } from "./i18n";
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const csrf =
    document.cookie
      .split("; ")
      .find((v) => /^(?:__Host-)?training_csrf=/.test(v))
      ?.split("=")[1] || "";
  const form = data instanceof FormData;
  const response = await fetch("/api/" + path, {
    method,
    credentials: "same-origin",
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
    throw new Error(
      message || t("The operation could not be completed. Please try again."),
    );
  }
  return body;
}
