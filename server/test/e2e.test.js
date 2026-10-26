// End-to-end: Node handlers + AI client against the real Python service (fake LLM, temp index).
// Runs only when PYTHON points to an interpreter with ai-service requirements installed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAiClient } from "../src/aiClient.js";
import { createHandlers } from "../src/handlers.js";

const PY = process.env.PYTHON;
const PORT = 5099;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../ai-service");
let proc;

const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const handlers = (token) =>
  createHandlers({ orgName: "Acme", callAi: createAiClient({ baseUrl: `http://127.0.0.1:${PORT}`, token }) });
const ask = async (h, sid, message) => { const r = res(); await h.chat({ sid, body: { message } }, r); return r; };

before(async () => {
  if (!PY) return;
  proc = spawn(PY, ["tests/fake_llm_server.py", String(PORT)], { cwd: root, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Python service did not start");
});
after(() => proc?.kill());

test("full round trip returns answer and sources", { skip: !PY }, async () => {
  const r = await ask(handlers("test-token"), "1".repeat(32), "how many days of paid annual leave");
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.answer, "You get 24 days of paid annual leave.");
  assert.ok(r.body.sources.some((s) => s.source === "Leave Policy.md"));
});

test("unrelated question gets the not-found answer", { skip: !PY }, async () => {
  const r = await ask(handlers("test-token"), "2".repeat(32), "zebra quantum xylophone");
  assert.deepEqual(r.body.sources, []);
  assert.match(r.body.answer, /could not find that/);
});

test("org name comes from the Python service", { skip: !PY }, async () => {
  const r = res();
  await createHandlers({ orgName: "Fallback", callAi: createAiClient({ baseUrl: `http://127.0.0.1:${PORT}`, token: "test-token" }) }).config({}, r);
  assert.deepEqual(r.body, { orgName: "Acme" });
});

test("reset round trip", { skip: !PY }, async () => {
  const r = res();
  await handlers("test-token").reset({ sid: "1".repeat(32) }, r);
  assert.deepEqual(r.body, { ok: true });
});

test("wrong service token is refused by the Python service", { skip: !PY }, async () => {
  const r = await ask(handlers("wrong"), "3".repeat(32), "annual leave");
  assert.equal(r.statusCode, 403);
  assert.deepEqual(r.body, { error: "Forbidden." });
});

test("Python service rejects direct calls with a forged session id", { skip: !PY }, async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Service-Token": "test-token", "X-Session-Id": "../x" },
    body: '{"message":"annual leave"}',
  });
  assert.equal(r.status, 400);
});
