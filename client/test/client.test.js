import assert from "node:assert/strict";
import { test } from "node:test";
import { getConfig, resetChat, sendMessage } from "../src/api.js";
import { MAX_QUESTION, addQuestion, applyReply, isSendKey, sourceLabel } from "../src/chat.js";

const mockFetch = (impl) => { globalThis.fetch = impl; };
const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body });

test("sendMessage posts JSON and returns answer + sources", async () => {
  let seen;
  mockFetch(async (url, init) => { seen = { url, init }; return reply(200, { answer: "a", sources: [{ source: "x", location: "" }] })(); });
  assert.deepEqual(await sendMessage("hi"), { answer: "a", sources: [{ source: "x", location: "" }] });
  assert.equal(seen.url, "/api/chat");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  assert.equal(seen.init.body, '{"message":"hi"}');
});

test("sendMessage defaults missing sources to []", async () => {
  mockFetch(reply(200, { answer: "a" }));
  assert.deepEqual(await sendMessage("hi"), { answer: "a", sources: [] });
});

test("sendMessage surfaces server errors, generic error, and network failure", async () => {
  mockFetch(reply(400, { error: "Type a question first." }));
  assert.deepEqual(await sendMessage(""), { error: "Type a question first." });
  mockFetch(async () => ({ ok: false, status: 500, json: async () => { throw new Error("html"); } }));
  assert.deepEqual(await sendMessage("hi"), { error: "Something went wrong. Try again." });
  mockFetch(async () => { throw new TypeError("Failed to fetch"); });
  assert.deepEqual(await sendMessage("hi"), { error: "Could not reach the server. Check that the app is still running." });
});

test("resetChat never throws", async () => {
  mockFetch(async () => { throw new Error("down"); });
  await resetChat();
});

test("getConfig falls back to the default org name", async () => {
  mockFetch(reply(200, { orgName: "Acme" }));
  assert.deepEqual(await getConfig(), { orgName: "Acme" });
  mockFetch(async () => { throw new Error("down"); });
  assert.deepEqual(await getConfig(), { orgName: "Your Company" });
});

test("source labels", () => {
  assert.equal(sourceLabel({ source: "Leave.pdf", location: "page 3" }), "Leave.pdf, page 3");
  assert.equal(sourceLabel({ source: "Leave.pdf", location: "" }), "Leave.pdf");
});

test("Enter sends; Shift+Enter and IME composition do not", () => {
  assert.equal(isSendKey({ key: "Enter", shiftKey: false, isComposing: false }), true);
  assert.equal(isSendKey({ key: "Enter", shiftKey: true, isComposing: false }), false);
  assert.equal(isSendKey({ key: "Enter", shiftKey: false, isComposing: true }), false);
  assert.equal(isSendKey({ key: "a", shiftKey: false, isComposing: false }), false);
});

test("question adds user bubble + pending bot bubble; reply replaces only that bubble", () => {
  let m = addQuestion([], 1, "q1");
  assert.deepEqual(m.map((x) => [x.role, x.kind, x.text]), [["user", undefined, "q1"], ["bot", "pending", "Searching the policies..."]]);
  m = addQuestion(m, 2, "q2");
  m = applyReply(m, 1, { answer: "a1", sources: [{ source: "s", location: "" }] });
  assert.deepEqual(m[1], { id: "b1", role: "bot", text: "a1", sources: [{ source: "s", location: "" }] });
  assert.equal(m[3].kind, "pending");
  m = applyReply(m, 2, { error: "boom" });
  assert.deepEqual(m[3], { id: "b2", role: "bot", kind: "error", text: "boom" });
});

test("UI limit matches the server limit", () => assert.equal(MAX_QUESTION, 1000));
