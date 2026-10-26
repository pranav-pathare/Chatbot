import assert from "node:assert/strict";
import { test } from "node:test";
import { createAiClient } from "../src/aiClient.js";
import { createHandlers } from "../src/handlers.js";
import { hashSid } from "../src/security.js";

const SID = "a".repeat(32);

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function setup(reply, opts = {}) {
  const calls = [], logs = [];
  const callAi = async (route, sid, body) => {
    calls.push({ route, sid, body });
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const h = createHandlers({ callAi, logChat: (d) => logs.push(d), orgName: "Acme", ...opts });
  return { h, calls, logs };
}

const run = async (fn, body) => {
  const res = fakeRes();
  await fn({ body, sid: SID }, res);
  return res;
};

test("config uses the AI service org name, falls back to ORG_NAME", async () => {
  let { h, calls } = setup({ ok: true, status: 200, data: { orgName: "Globex" } });
  assert.deepEqual((await run(h.config)).body, { orgName: "Globex" });
  assert.deepEqual(calls[0], { route: "/api/config", sid: null, body: "GET" });
  ({ h } = setup(new Error("down")));
  assert.deepEqual((await run(h.config)).body, { orgName: "Acme" });
  ({ h } = setup({ ok: true, status: 200, data: { orgName: "  " } }));
  assert.deepEqual((await run(h.config)).body, { orgName: "Acme" });
});

test("chat passes the trimmed question and session id, returns answer + sources", async () => {
  const { h, calls, logs } = setup({ ok: true, status: 200, data: { answer: "24 days", sources: [{ source: "Leave.pdf", location: "page 2" }] } });
  const res = await run(h.chat, { message: "  leave?  " });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { answer: "24 days", sources: [{ source: "Leave.pdf", location: "page 2" }] });
  assert.deepEqual(calls, [{ route: "/api/chat", sid: SID, body: { message: "leave?" } }]);
  assert.equal(logs[0].sid, hashSid(SID));
  assert.notEqual(logs[0].sid, SID);
});

test("chat validation errors never reach the AI service", async () => {
  const { h, calls } = setup();
  assert.deepEqual((await run(h.chat, { message: "" })).body, { error: "Type a question first." });
  const long = await run(h.chat, { message: "x".repeat(1001) });
  assert.equal(long.statusCode, 400);
  assert.deepEqual(long.body, { error: "Keep your question under 1,000 characters." });
  assert.equal(calls.length, 0);
});

test("AI service errors are passed through with their status", async () => {
  const { h, logs } = setup({ ok: false, status: 500, data: { error: "XAI_API_KEY is missing." } });
  const res = await run(h.chat, { message: "hi" });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: "XAI_API_KEY is missing." });
  assert.equal(logs[0].error, "XAI_API_KEY is missing.");
});

test("AI service error without a message gets the generic one", async () => {
  const { h } = setup({ ok: false, status: 503, data: {} });
  assert.deepEqual((await run(h.chat, { message: "hi" })).body, { error: "Something went wrong. Try again." });
});

test("unreachable AI service -> 502, timeout -> 504", async () => {
  let res = await run(setup(new TypeError("fetch failed")).h.chat, { message: "hi" });
  assert.equal(res.statusCode, 502);
  assert.match(res.body.error, /not reachable/);
  const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
  res = await run(setup(timeout).h.chat, { message: "hi" });
  assert.equal(res.statusCode, 504);
});

test("unexpected AI response shape is sanitised", async () => {
  const { h } = setup({ ok: true, status: 200, data: { answer: { evil: 1 }, sources: [{ source: 1, location: null, extra: "x" }], debug: "secret" } });
  const res = await run(h.chat, { message: "hi" });
  assert.deepEqual(res.body, { answer: "", sources: [{ source: "1", location: "" }] });
});

test("rate limited requests get 429 and skip the AI service", async () => {
  const { h, calls } = setup({ ok: true, status: 200, data: {} }, { allowChat: () => false });
  const res = await run(h.chat, { message: "hi" });
  assert.equal(res.statusCode, 429);
  assert.equal(calls.length, 0);
});

test("reset always answers ok, even if the AI service is down", async () => {
  const { h, calls } = setup(new Error("down"));
  assert.deepEqual((await run(h.reset)).body, { ok: true });
  assert.equal(calls[0].route, "/api/reset");
});

test("AI client sends session id, service token and JSON", async () => {
  let seen;
  const callAi = createAiClient({
    baseUrl: "http://ai", token: "tok",
    fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ answer: "x" }) }; },
  });
  const r = await callAi("/api/chat", SID, { message: "q" });
  assert.equal(seen.url, "http://ai/api/chat");
  assert.equal(seen.init.headers["X-Session-Id"], SID);
  assert.equal(seen.init.headers["X-Service-Token"], "tok");
  assert.equal(seen.init.body, '{"message":"q"}');
  assert.ok(seen.init.signal instanceof AbortSignal);
  assert.deepEqual(r, { ok: true, status: 200, data: { answer: "x" } });
});

test("AI client GET has no body and a short timeout", async () => {
  let seen;
  const callAi = createAiClient({ baseUrl: "http://ai", token: "tok", fetchImpl: async (url, init) => { seen = init; return { ok: true, status: 200, json: async () => ({}) }; } });
  await callAi("/api/config", null, "GET");
  assert.equal(seen.method, "GET");
  assert.equal(seen.body, undefined);
  assert.equal(seen.headers["X-Service-Token"], "tok");
});

test("AI client tolerates a non-JSON error page", async () => {
  const callAi = createAiClient({ baseUrl: "http://ai", fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new Error("html"); } }) });
  assert.deepEqual(await callAi("/api/chat", SID, {}), { ok: false, status: 502, data: {} });
});
