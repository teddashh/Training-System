import test from "node:test";
import assert from "node:assert/strict";
import { readBody } from "./responseBody.ts";

const lost = (reason: unknown) => new Error("unreachable", { cause: reason });

test("a body is JSON; an empty one or a page that is not JSON is an empty answer", async () => {
  assert.deepEqual(await readBody(new Response('{"status":"in_progress","answers":{"1":"a"}}'), lost), { status: "in_progress", answers: { "1": "a" } });
  assert.deepEqual(await readBody(new Response(null, { status: 204 }), lost), {});
  assert.deepEqual(await readBody(new Response("<html>Bad gateway</html>", { status: 502 }), lost), {});
  assert.deepEqual(await readBody(new Response("[1,2]"), lost), [1, 2]);
});

test("a body cut off on its way is a failure, never an empty answer", async () => {
  const cut = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"status":"in_pro')); controller.error(new TypeError("terminated")); },
  }));
  await assert.rejects(readBody(cut, lost), (error: Error) => error.message === "unreachable" && (error.cause as Error).message === "terminated");
  const timedOut = { text: () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError")) };
  await assert.rejects(readBody(timedOut, lost), /unreachable/);
});
