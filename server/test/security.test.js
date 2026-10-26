import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SECURITY_HEADERS,
  createRateLimiter,
  hashSid,
  isSameOrigin,
  newSid,
  parseCookies,
  parseTrustProxy,
  sessionCookie,
  signSid,
  validateQuestion,
  verifySid,
} from "../src/security.js";

const SECRET = "test-secret";

test("new session ids are 32 random hex chars", () => {
  const a = newSid();
  assert.match(a, /^[a-f0-9]{32}$/);
  assert.notEqual(a, newSid());
});

test("signed session id round-trips", () => {
  const sid = newSid();
  assert.equal(verifySid(signSid(sid, SECRET), SECRET), sid);
});

test("forged, tampered or malformed session cookies are rejected", () => {
  const sid = newSid();
  const good = signSid(sid, SECRET);
  const other = newSid();
  for (const bad of [
    undefined, null, 42, "", sid, `${sid}.`, `${other}${good.slice(32)}`, good + "x",
    signSid(sid, "wrong-secret"), signSid("../../etc/passwd", SECRET), signSid("A".repeat(32), SECRET),
  ]) assert.equal(verifySid(bad, SECRET), null, String(bad));
});

test("cookie parsing", () => {
  assert.deepEqual(parseCookies("a=1; sid=x.y; b=%20z"), { a: "1", sid: "x.y", b: " z" });
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies("sid=first; sid=second"), { sid: "first" });
  assert.deepEqual(parseCookies("bad=%E0%A4%A"), { bad: "%E0%A4%A" });
});

test("session cookie flags", () => {
  assert.equal(sessionCookie("v"), "sid=v; Path=/; HttpOnly; SameSite=Lax");
  assert.match(sessionCookie("v", { secure: true }), /; Secure$/);
});

test("session id hash for logs is stable and not the id", () => {
  const sid = newSid();
  assert.equal(hashSid(sid), hashSid(sid));
  assert.notEqual(hashSid(sid), sid);
});

test("question validation keeps the original messages", () => {
  assert.deepEqual(validateQuestion({ message: "  hi  " }), { question: "hi" });
  assert.deepEqual(validateQuestion({ message: "x".repeat(1000) }), { question: "x".repeat(1000) });
  assert.deepEqual(validateQuestion({ message: "x".repeat(1001) }), { error: "Keep your question under 1,000 characters." });
  for (const body of [undefined, null, {}, [], "hi", { message: "" }, { message: "  " }, { message: 1 },
    { message: ["hi"] }, { message: { $gt: "" } }, { message: null }])
    assert.deepEqual(validateQuestion(body), { error: "Type a question first." }, JSON.stringify(body));
});

test("rate limiter allows the limit, blocks after, resets per window", () => {
  let t = 0;
  const allow = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  assert.deepEqual([1, 2, 3, 4].map(() => allow("a")), [true, true, true, false]);
  assert.equal(allow("b"), true); // separate key
  t = 1000;
  assert.equal(allow("a"), true);
});

test("rate limiter memory is bounded", () => {
  const allow = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0, maxKeys: 5 });
  for (let i = 0; i < 100; i++) allow(`k${i}`);
  assert.equal(allow("k99"), false); // newest entry kept
});

test("same-origin check", () => {
  assert.equal(isSameOrigin(undefined, "app:5000"), true);
  assert.equal(isSameOrigin("http://app:5000", "app:5000"), true);
  assert.equal(isSameOrigin("https://evil.com", "app:5000"), false);
  assert.equal(isSameOrigin("null", "app:5000"), false);
  assert.equal(isSameOrigin("https://ui.corp", "app:5000", ["https://ui.corp"]), true);
});

test("security headers include CSP and anti-framing", () => {
  assert.match(SECURITY_HEADERS["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(SECURITY_HEADERS["Content-Security-Policy"], /script-src 'self'/);
  assert.doesNotMatch(SECURITY_HEADERS["Content-Security-Policy"], /script-src[^;]*unsafe/);
  assert.equal(SECURITY_HEADERS["X-Frame-Options"], "DENY");
  assert.equal(SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
});

test("TRUST_PROXY numbers become hop counts, not IP strings", () => {
  assert.equal(parseTrustProxy("1"), 1);
  assert.equal(parseTrustProxy(" 2 "), 2);
  assert.equal(parseTrustProxy(""), false);
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy("false"), false);
  assert.equal(parseTrustProxy("true"), true);
  assert.equal(parseTrustProxy("10.0.0.1, 10.0.0.2"), "10.0.0.1, 10.0.0.2");
});
