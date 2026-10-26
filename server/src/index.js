// Entry point: read settings, connect MongoDB (optional), start the API.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { createAiClient } from "./aiClient.js";
import { createApp } from "./app.js";
import { parseTrustProxy } from "./security.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, "../.env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const PORT = Number(env.PORT || 5000);
const AI = env.AI_SERVICE_URL || "http://127.0.0.1:5001";

let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString("hex");
  console.warn("SESSION_SECRET not set: using a random one (sessions reset when the server restarts).");
}
if (env.COOKIE_SECURE === "true")
  console.warn("COOKIE_SECURE=true: browsers only send the session cookie over HTTPS (or http://localhost).");
if (!env.AI_SERVICE_TOKEN) console.warn("AI_SERVICE_TOKEN not set: the Python service accepts any local caller.");

// Chat log (audit only). The app works without it; the AI service owns conversation memory.
const retentionDays = Number(env.LOG_RETENTION_DAYS || 90);
const chatLogSchema = new mongoose.Schema(
  {
    sid: { type: String, index: true }, // SHA-256 of the session id, not the id itself
    question: String,
    answer: String,
    sources: [{ _id: false, source: String, location: String }],
    error: String,
  },
  { timestamps: true }
);
// MongoDB deletes each log entry automatically after LOG_RETENTION_DAYS (0 keeps them forever).
if (retentionDays > 0) chatLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: retentionDays * 86400 });
const ChatLog = mongoose.model("ChatLog", chatLogSchema);

function connectMongo() {
  mongoose
    .connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 3000 })
    .then(() => console.log("MongoDB connected: chat logging on"))
    .catch((e) => {
      console.warn(`MongoDB unavailable (${e.message}): chat logging off, retrying in 30 s`);
      setTimeout(connectMongo, 30000).unref();
    });
}
if (env.MONGODB_URI) connectMongo();
const dbReady = () => mongoose.connection.readyState === 1; // checked on every write

const app = createApp({
  callAi: createAiClient({ baseUrl: AI, token: env.AI_SERVICE_TOKEN || "" }),
  logChat: (doc) => dbReady() && ChatLog.create(doc).catch(() => {}),
  orgName: env.ORG_NAME || "Your Company",
  sessionSecret,
  cookieSecure: env.COOKIE_SECURE === "true",
  allowedOrigins: (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  ratePerMinute: Number(env.RATE_LIMIT_PER_MIN || 20),
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  distDir: path.join(here, "../../client/dist"),
});

app.listen(PORT, () => console.log(`API on http://localhost:${PORT} -> AI service ${AI}`));
