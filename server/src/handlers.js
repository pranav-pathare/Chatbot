// Route handlers. Framework-agnostic (only use req.body / req.sid and res.status().json()),
// so they can be tested with plain objects.
import { hashSid, validateQuestion } from "./security.js";

const SERVICE_DOWN = "The answer service is not reachable. Check that it is running.";

export function createHandlers({ callAi, logChat = () => {}, orgName, allowChat = () => true }) {
  return {
    // The org name lives in ai-service/.env (one place); ORG_NAME here is only a fallback.
    async config(_req, res) {
      const r = await callAi("/api/config", null, "GET").catch(() => null);
      const name = r?.ok && typeof r.data.orgName === "string" && r.data.orgName.trim() ? r.data.orgName : orgName;
      res.json({ orgName: name });
    },

    async chat(req, res) {
      if (!allowChat(req)) return res.status(429).json({ error: "Too many questions. Wait a minute and try again." });
      const { question, error } = validateQuestion(req.body);
      if (error) return res.status(400).json({ error });
      const who = hashSid(req.sid);
      try {
        const r = await callAi("/api/chat", req.sid, { message: question });
        if (!r.ok) {
          logChat({ sid: who, question, error: r.data.error });
          const status = r.status >= 400 && r.status < 600 ? r.status : 502;
          return res.status(status).json({ error: r.data.error || "Something went wrong. Try again." });
        }
        const answer = typeof r.data.answer === "string" ? r.data.answer : "";
        const sources = Array.isArray(r.data.sources)
          ? r.data.sources.map((s) => ({ source: String(s?.source ?? ""), location: String(s?.location ?? "") }))
          : [];
        logChat({ sid: who, question, answer, sources });
        res.json({ answer, sources });
      } catch (e) {
        const timedOut = e?.name === "TimeoutError";
        res.status(timedOut ? 504 : 502).json({ error: timedOut ? "The answer took too long. Try again." : SERVICE_DOWN });
      }
    },

    async reset(req, res) {
      await callAi("/api/reset", req.sid).catch(() => {});
      res.json({ ok: true });
    },
  };
}
