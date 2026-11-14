import test from "node:test";
import assert from "node:assert/strict";
import { arrival, noteArrival } from "./serverClock.ts";

test("an answer keeps the moment it arrived, also when it is shown later or as a copy", () => {
  noteArrival([{ id: 1, server_time: "2026-11-14T10:00:00Z", assessments: [{ server_time: "2026-11-14T10:00:01Z" }] }], 1000);
  assert.equal(arrival("2026-11-14T10:00:00Z", 9000), 1000);
  assert.equal(arrival("2026-11-14T10:00:01Z", 9000), 1000);
  // Never noted: it arrives when it is first asked for.
  assert.equal(arrival("2026-11-14T10:05:00Z", 9000), 9000);
  assert.equal(arrival("2026-11-14T10:05:00Z", 12000), 9000);
});

test("answers without a server time and other values are ignored", () => {
  for (const body of [null, undefined, "text", 3, [], {}, { server_time: null }, { rows: [1, "a", null] }]) noteArrival(body, 5);
  assert.equal(arrival("2026-11-14T11:00:00Z", 7), 7);
});

test("old answers are forgotten before the list grows without end; recent ones stay", () => {
  for (let index = 0; index < 1000; index++) arrival(`answer-${index}`, index);
  assert.equal(arrival("answer-999", 5000), 999);
  assert.equal(arrival("answer-0", 5000), 5000);
});
