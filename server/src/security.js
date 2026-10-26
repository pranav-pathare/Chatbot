// Security helpers. Plain functions with no npm dependencies, so they can be unit tested anywhere.
import crypto from "node:crypto";

export const MAX_QUESTION = 1000;
const SID_RE = /^[a-f0-9]{32}$/;

export const newSid = () => crypto.randomBytes(16).toString("hex");

const mac = (value, secret) => crypto.createHmac("sha256", secret).update(value).digest("base64url");

// Cookie value is "<sid>.<hmac>" so a browser can't pick or forge someone else's session id.
export const signSid = (sid, secret) => `${sid}.${mac(sid, secret)}`;

export function verifySid(value, secret) {
  if (typeof value !== "string") return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const sid = value.slice(0, dot);
  const sent = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(sid, secret));
  if (!SID_RE.test(sid) || sent.length !== expected.length) return null;
  return crypto.timingSafeEqual(sent, expected) ? sid : null;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key || key in out) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function sessionCookie(value, { secure = false } = {}) {
  return `sid=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

// Mongo logs store a hash, so a database reader can't reuse a live session id.
export const hashSid = (sid) => crypto.createHash("sha256").update(sid).digest("hex").slice(0, 32);

export function validateQuestion(body) {
  const message = body && typeof body === "object" && !Array.isArray(body) ? body.message : undefined;
  const question = typeof message === "string" ? message.trim() : "";
  if (!question) return { error: "Type a question first." };
  if (question.length > MAX_QUESTION) return { error: "Keep your question under 1,000 characters." };
  return { question };
}

// Fixed-window counter per key (session or IP). In memory: fine for one server process.
export function createRateLimiter({ limit, windowMs, now = () => Date.now(), maxKeys = 10000 }) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      if (!entry && hits.size >= maxKeys) {
        for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
      }
      hits.set(key, { start: t, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

// Blocks cross-site POSTs from browsers that send an Origin header (CSRF defence on top of SameSite).
export function isSameOrigin(origin, host, allowed = []) {
  if (!origin) return true; // same-origin GETs and non-browser clients send no Origin
  if (allowed.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
};

// Express treats a string "1" as an IP address, not a hop count, so convert numbers.
export function parseTrustProxy(value) {
  const v = String(value ?? "").trim();
  if (!v || v === "false") return false;
  if (v === "true") return true;
  return /^\d+$/.test(v) ? Number(v) : v;
}
