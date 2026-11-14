/** When each answer of the server arrived, by its `server_time`. A countdown follows the server's clock from
 *  that moment on the device's monotonic clock, wherever and whenever the answer is shown, also as a copy. */
const arrivals = new Map<string, number>();

/** The moment an answer arrived; an answer never noted before arrives now. */
export function arrival(serverTime: string, now = performance.now()): number {
  const known = arrivals.get(serverTime);
  if (known !== undefined) return known;
  // Answers no longer on screen are forgotten, oldest first.
  if (arrivals.size >= 400) for (const key of [...arrivals.keys()].slice(0, 200)) arrivals.delete(key);
  arrivals.set(serverTime, now);
  return now;
}

/** Notes the arrival of every `server_time` in an answer, rows and nested rows included. */
export function noteArrival(body: unknown, now = performance.now(), depth = 0): void {
  if (!body || typeof body !== "object" || depth > 5) return;
  for (const [key, value] of Object.entries(body)) {
    if (key === "server_time" && typeof value === "string") arrival(value, now);
    else if (value && typeof value === "object") noteArrival(value, now, depth + 1);
  }
}
