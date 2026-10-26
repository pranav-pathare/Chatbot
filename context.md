# context.md — Guardrail for the Policy Chatbot

Read this before changing anything. If a change conflicts with a rule below, stop and ask the owner. Do not work around it.

## 1. What this app is
An internal chatbot that answers employee questions (leave, assets, etc.) **only from the company's own documents** in `ai-service/docs/`, and shows which document each answer came from.

## 2. Architecture (do not collapse or reorder)
```
Browser (React + Vite + Framer Motion)   client/
   -> Express API (Node, MongoDB log)    server/    :5000  (only thing the browser talks to)
      -> Python RAG service (Flask)      ai-service/ :5001 (127.0.0.1 only, internal)
         -> Chroma (chroma_db/) + Grok (xAI) + keyword/local/openai embeddings
```
- The browser never calls the Python service or the LLM directly.
- Python owns retrieval, prompting and conversation memory. Express owns the session cookie, input validation, and audit logging. React owns presentation only.

## 3. Functionality that MUST NOT change
1. `POST /api/chat` takes `{message}` and returns `{answer, sources:[{source, location}]}`. Errors return `{error}` with a non-2xx status.
2. `POST /api/reset` clears that browser session's memory ("New chat"). `GET /api/config` returns `{orgName}`, read from `ai-service/.env` (server `ORG_NAME` is only a fallback).
3. Validation: empty message -> 400 "Type a question first."; over 1,000 characters -> 400 "Keep your question under 1,000 characters."
4. Answers use ONLY retrieved excerpts. No outside knowledge, no invented numbers/dates/names/links. If nothing relevant is found, say so and point to HR. Keep `[[NOT_FOUND]]` handling (answer shown, sources dropped).
5. Sources are de-duplicated by (source, location) and capped at 4.
6. Conversation memory is temporary: per-session, in the Python process, last `HISTORY_TURNS` pairs (0 = off), max 500 sessions with least-recently-used eviction, lost on restart. Follow-up questions are rewritten to standalone questions before retrieval. An empty model reply becomes the not-found answer.
7. Retrieval settings (`TOP_K`, `MAX_DISTANCE`, chunking, embedding providers) stay as they are unless the owner asks. `ingest.py` supports the 34 extensions in `LOADERS`, does a full rebuild into a new collection, and switches `chroma_db/ACTIVE` only after the build succeeds. A file that fails adds no chunks. Symlinks and files over `MAX_FILE_MB` are skipped.
8. Plain-text answers: no markdown rendering in the UI; preserve line breaks (`white-space: pre-wrap`).
9. UI behavior: starter questions, Enter sends / Shift+Enter newline, 1,000-char limit, "Searching the policies..." pending state, source chips, error styling, "New chat" disabled while a request is in flight, HR-confirmation disclaimer, org name in the header.
10. Zscaler/proxy and setup error messages from the Python service are passed through verbatim.

## 4. Security and data rules
- Never commit secrets: `.env`, API keys, tokens. Only `.env.example` files are tracked.
- Session id lives in a signed (HMAC), httpOnly, sameSite=lax cookie. The Python service listens on 127.0.0.1 only, requires `X-Service-Token` (= `AI_SERVICE_TOKEN`, same value in both `.env` files) and refuses to start without it. Do not expose port 5001 or remove the token check.
- Keep these protections: security headers/CSP (`server/src/security.js`), Origin check + JSON-only `/api/chat`, 16 KB body limits, rate limits, model timeouts and `MAX_TOKENS`, strict body type checks, JSON-only errors without stack traces.
- Document parsing must stay safe: use defusedxml for XML, keep size caps (file and e-book), never follow symlinks out of `docs/`, keep subprocess timeouts.
- Render all model/user text as text (React escapes by default). Never use `dangerouslySetInnerHTML`.
- MongoDB stores audit logs only (hashed session id, question, answer, sources, error) with a TTL (`LOG_RETENTION_DAYS`). It must stay optional: the app must work if MongoDB is down. Do not store raw session ids, documents or API keys there.
- No authentication exists yet. Do not claim the app is access-controlled.

## 5. Design and UI rules
- Framer Motion for all motion; respect reduced motion (`MotionConfig reducedMotion="user"` is set in `main.jsx`). Animation must never delay or block sending a message.
- Keep text contrast readable on the dark theme, keep visible focus rings, keep keyboard operability.
- Presentation changes are free; the behavior in section 3 is not.

## 6. Change rules
- Prefer small, reviewable changes. Don't add dependencies without need.
- Don't edit `ai-service/chroma_db/` by hand; rebuild with `python ingest.py` after changing `docs/` or embedding/chunk settings.
- If you change the API contract in section 3, update this file, `server/`, `client/src/api.js` and `ai-service/app.py` together.
- Keep security logic in dependency-free modules (`security.js`, `handlers.js`, `aiClient.js`, `chat.js`) so it stays testable.
- Before finishing, all tests pass: `cd ai-service && python -m pytest -q tests`, `cd server && PYTHON=../ai-service/.venv/bin/python npm test`, `cd client && npm test`. Then: client builds (`npm run build`), server starts, `/api/chat` round-trips, README commands still work. Record what you tested in TESTING.md.
