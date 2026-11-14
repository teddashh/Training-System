/** The body of an answer as JSON; {} when it is empty or not JSON (an HTML error page). A body cut off on its
 *  way (connection lost, time ran out) rejects with `lost(reason)`: it must not pass for an empty answer. */
// The shape is the caller's to know, as with `Response.json()`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readBody(response: Pick<Response, "text">, lost: (reason: unknown) => Error): Promise<any> {
  let text: string;
  try {
    text = await response.text();
  } catch (reason) {
    throw lost(reason);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
