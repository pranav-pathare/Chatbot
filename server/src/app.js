// Express wiring: middleware order matters (headers -> session -> origin check -> body -> routes).
import path from "node:path";
import express from "express";
import { createHandlers } from "./handlers.js";
import {
  SECURITY_HEADERS,
  createRateLimiter,
  isSameOrigin,
  newSid,
  parseCookies,
  sessionCookie,
  signSid,
  verifySid,
} from "./security.js";

export function createApp({ callAi, logChat, orgName, sessionSecret, cookieSecure, allowedOrigins, ratePerMinute, distDir, trustProxy }) {
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", trustProxy);

  app.use((_req, res, next) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    next();
  });

  // Each browser gets a random id in a signed, httpOnly cookie (same idea as the old Flask session).
  app.use((req, res, next) => {
    let sid = verifySid(parseCookies(req.headers.cookie).sid, sessionSecret);
    if (!sid) {
      sid = newSid();
      res.append("Set-Cookie", sessionCookie(signSid(sid, sessionSecret), { secure: cookieSecure }));
    }
    req.sid = sid;
    next();
  });

  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && !isSameOrigin(req.headers.origin, req.headers.host, allowedOrigins))
      return res.status(403).json({ error: "Cross-site request blocked." });
    if (req.method === "POST" && req.path === "/chat" && !req.is("application/json"))
      return res.status(415).json({ error: "Send the question as JSON." });
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  const bySession = createRateLimiter({ limit: ratePerMinute, windowMs: 60000 });
  const byIp = createRateLimiter({ limit: ratePerMinute * 3, windowMs: 60000 });
  const h = createHandlers({ callAi, logChat, orgName, allowChat: (req) => bySession(req.sid) && byIp(req.ip) });

  app.get("/api/config", h.config);
  app.post("/api/chat", h.chat);
  app.post("/api/reset", h.reset);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

  // Serve the built React app in production.
  app.use(express.static(distDir, { index: false }));
  app.get("*", (_req, res, next) => res.sendFile(path.join(distDir, "index.html"), (e) => e && next()));

  // JSON errors only; never send stack traces to the browser.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Keep your question under 1,000 characters." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Type a question first." });
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Something went wrong. Try again." : "Bad request." });
  });

  return app;
}
