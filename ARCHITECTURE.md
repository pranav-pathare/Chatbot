# How the Policy Chatbot is built

This document explains how the app is put together: what each technology does, why it is there, and what every file and important function does. It assumes you can read a little code, but you don't need to know React, Express or AI beforehand.

Related files:
- [README.md](README.md): how to install and run it.
- [context.md](context.md): rules that must not be broken when changing the code.
- [TESTING.md](TESTING.md): what was tested and what changed as a result.

---

## 1. What the app does

An employee types a question such as "How many leave days do I get?". The app finds the passages in the company's own documents that relate to the question and asks an AI model to answer **using only those passages**. The answer comes back with the names of the documents it was based on. If the documents don't cover the question, the app says so and points the employee to HR, instead of guessing.

This pattern is called **RAG (Retrieval-Augmented Generation)**:
1. **Retrieval**: find the relevant pieces of text.
2. **Augmented**: add those pieces to the question.
3. **Generation**: the AI model writes the answer from them.

---

## 2. The big picture

```
 ┌──────────────────────────┐   HTTP (JSON)   ┌──────────────────────────┐   HTTP (JSON)   ┌──────────────────────────────┐
 │  Browser                 │ ─────────────▶  │  Express API (Node.js)   │ ─────────────▶  │  AI service (Python, Flask)  │
 │  React + Framer Motion   │                 │  server/   port 5000     │                 │  ai-service/  127.0.0.1:5001 │
 │  client/                 │ ◀─────────────  │  cookie, checks, limits  │ ◀─────────────  │  search + AI answer + memory │
 └──────────────────────────┘                 └────────────┬─────────────┘                 └──────────────┬───────────────┘
                                                           │ (optional)                                   │
                                                           ▼                                              ▼
                                              ┌──────────────────────────┐                 ┌──────────────────────────────┐
                                              │  MongoDB: chat audit log │                 │  Chroma index (chroma_db/)   │
                                              └──────────────────────────┘                 │  Grok model (xAI, internet)  │
                                                                                           └──────────────────────────────┘
 Before any of this runs, `python ingest.py` reads docs/ and builds the Chroma index.
```

Why three parts?
- **Browser (React)**: only shows things. It never sees API keys or documents directly.
- **Express API**: the single front door. It identifies each browser, rejects bad or abusive requests, logs chats to MongoDB and passes good requests on.
- **AI service (Python)**: does the AI work. Python is used because the best document-reading and AI libraries are Python libraries. It listens only on `127.0.0.1` (this machine), so nothing on the network can reach it directly.

"MERN" stands for **M**ongoDB, **E**xpress, **R**eact and **N**ode.js. The Python service is added on top for the AI part.

---

## 3. What happens when someone asks a question

1. The employee types into the box in the browser and presses Enter. `App.jsx` adds their message bubble and a "Searching the policies..." bubble, then calls `sendMessage()` in `api.js`.
2. `api.js` sends `POST /api/chat` with `{"message": "..."}`. In development, Vite forwards it to Express on port 5000.
3. **Express** (`server/src/app.js`):
   - adds security headers to the response;
   - reads the signed `sid` cookie, or creates a new random session id if there isn't a valid one;
   - blocks the request if it came from another website (origin check) or isn't JSON;
   - parses the JSON body (max 16 KB);
   - `handlers.chat` checks the rate limit, validates the question (not empty, at most 1,000 characters), then calls the AI service using `aiClient.js`.
4. **AI service** (`ai-service/app.py`):
   - checks the shared `X-Service-Token`, so only Express can call it;
   - checks the session id format and the question;
   - calls `rag.ask(session_id, question)`.
5. **`rag.ask`** (`ai-service/rag.py`):
   - loads this session's recent conversation;
   - if there is earlier conversation, asks the model to rewrite a follow-up such as "and for contractors?" into a full question;
   - **retrieves**: turns the question into numbers (an embedding) and asks Chroma for the 5 closest document chunks, dropping any that are too far away;
   - if nothing is close enough, returns "I could not find that in the company documents..." without calling the model;
   - otherwise builds the prompt (rules + earlier turns + excerpts + question) and calls Grok;
   - if the model says `[[NOT_FOUND]]`, or replies with nothing, it returns the not-found answer and no sources;
   - saves the question and answer to the session's memory and returns `{answer, sources}`.
6. Express logs the exchange to MongoDB (if connected) and returns `{answer, sources}` to the browser.
7. `App.jsx` replaces the "Searching..." bubble with the answer and its source chips, with an animation.

"New chat" calls `POST /api/reset`, which makes the AI service forget that session's memory, and then clears the screen.

---

## 4. Technologies and libraries

### 4.1 Frontend (`client/`)
| Technology | What it is | What it does here |
|---|---|---|
| **React 18** | A JavaScript library for building user interfaces from *components* (functions that return what to show). When *state* changes, React updates the page. | The whole chat screen is one component tree in `App.jsx`. |
| **Vite** | A development server and build tool. | `npm run dev` serves the app with instant reload and forwards `/api` calls to Express. `npm run build` produces optimised files in `client/dist/`. |
| **@vitejs/plugin-react** | Vite plugin. | Lets Vite understand JSX (HTML-like syntax inside JavaScript). |
| **Framer Motion** | An animation library for React. You write `<motion.div animate={{...}}>` and it animates. | Message bubbles slide in, starter cards rise on hover, the typing dots pulse, background colour blobs drift. `MotionConfig reducedMotion="user"` turns movement off for people who chose "reduce motion" in their operating system. |
| **Inter font** (Google Fonts) | A typeface. | Body text. |
| **fetch** (built into browsers) | Sends HTTP requests. | Used in `api.js`. |

### 4.2 API server (`server/`)
| Technology | What it is | What it does here |
|---|---|---|
| **Node.js (21.7+)** | Runs JavaScript outside the browser. | Runs the API. Built-in parts used: `crypto` (random ids, HMAC signatures, hashes), `fetch` (calls the AI service), `process.loadEnvFile` (reads `.env`), `node:test` (tests). |
| **Express 4** | A small web framework: you add *middleware* (functions every request passes through) and *routes* (functions for specific URLs). | Security headers, sessions, origin check, JSON parsing, the three API routes, serving the built React app, JSON error responses. |
| **Mongoose 8** | A library for talking to MongoDB with schemas. | Defines the `ChatLog` model and writes one document per question. |
| **MongoDB** | A document database. | Optional audit log of questions and answers. Entries expire automatically after `LOG_RETENTION_DAYS` (default 90). |

The `cookie-parser`, `dotenv` and `helmet` packages are deliberately **not** used. The few lines they would provide are written out in `security.js` and `index.js`, which means fewer third-party dependencies and lets the security code be tested without installing anything.

### 4.3 AI service (`ai-service/`)
| Technology | What it is | What it does here |
|---|---|---|
| **Python 3.9+** | Programming language. | Runs the AI service and the ingest script. |
| **Flask** | A small Python web framework. | Exposes `/api/chat`, `/api/reset`, `/api/config` and `/health` to Express. |
| **Chroma (chromadb)** | A *vector database*: it stores text along with embeddings and finds the closest ones to a query. | Stores document chunks in `chroma_db/` and answers "which chunks are most similar to this question?" using cosine distance. |
| **Embeddings** | A list of numbers that represents the meaning (or the words) of a text. Similar texts get similar numbers. | Three choices (`EMBED_PROVIDER`): `keyword` (default: offline, hashes words and word pairs into 4,096 numbers), `local` (a small neural model, MiniLM, downloaded once), `openai` (OpenAI's embedding API). |
| **openai** (Python SDK) | Client library for OpenAI-compatible APIs. | Talks to **Grok** at `api.x.ai`, because xAI's API is OpenAI-compatible. Also used for OpenAI embeddings if chosen. |
| **Grok (xAI)** | A large language model (LLM). | Writes the answer from the excerpts and rewrites follow-up questions. Configured by `CHAT_MODEL`. |
| **python-dotenv** | Reads `.env` files into settings. | Used by `config.py`. |
| **pypdf** | Reads PDFs. | Text per page, so sources can say "page 3". |
| **python-docx** | Reads Word `.docx`. | Paragraphs and table rows. |
| **python-pptx** | Reads PowerPoint `.pptx`. | Slide text, tables and speaker notes, per slide. |
| **pandas + openpyxl + xlrd + odfpy** | Table/spreadsheet tools. | Read `.xlsx/.xlsm/.xls/.ods/.csv/.tsv` and turn each row into "Column: value \| Column: value". odfpy also reads `.odt/.odp`. |
| **beautifulsoup4** | HTML parser. | Turns `.html`, e-book pages and HTML e-mails into clean text, removing scripts and styles. |
| **defusedxml** | A safe XML parser. | Reads `.xml` while refusing malicious files (entity-expansion "billion laughs" attacks, external entities). |
| **striprtf** | RTF reader. | Plain text from `.rtf`. |
| **extract-msg** | Outlook `.msg` reader. | Subject, sender, date and body. |
| **email** (built into Python) | E-mail parser. | Reads `.eml` files. |
| **pytesseract + Tesseract** *(optional)* | OCR (reading text from images). | Only used if installed: reads scanned PDF pages and `.png/.jpg/.tif/.bmp` images. |
| **LibreOffice** *(optional)* | Office suite. | Only used if installed: converts old `.doc/.ppt` to `.docx/.pptx` before reading them. |
| **pytest** *(tests only)* | Python test runner. | Runs `ai-service/tests/`. |

---

## 5. File-by-file guide

### 5.1 Root
| File | Purpose |
|---|---|
| `README.md` | Setup and run instructions. |
| `context.md` | Guardrail: the behaviour and security rules any change must keep. |
| `ARCHITECTURE.md` | This file. |
| `TESTING.md` | Test report and change log. |
| `.gitignore` | Keeps `node_modules/`, `dist/`, `.env`, virtual environments and caches out of git. |

### 5.2 `client/` (React UI)
| File | What it does |
|---|---|
| `index.html` | The single HTML page. Loads the Inter font and `src/main.jsx`. |
| `vite.config.js` | Enables the React plugin; dev server on port 5173; forwards `/api/*` to `http://localhost:5000`. |
| `package.json` | Dependencies and scripts: `dev`, `build`, `preview`, `test`. |
| `src/main.jsx` | Entry point. Mounts `<App/>` into `#root` inside `<MotionConfig reducedMotion="user">` and imports the CSS. |
| `src/App.jsx` | The whole interface (see the components below). |
| `src/api.js` | The only file that talks to the server. |
| `src/chat.js` | Small pure helper functions with no React, so they can be unit tested. |
| `src/styles.css` | All styling: dark theme, glass panels, gradient accents, layout, focus rings. |
| `test/client.test.js` | Unit tests for `api.js` and `chat.js`. |

**Components in `App.jsx`**
| Component / function | What it does |
|---|---|
| `Orbs` | Two blurred colour circles that drift slowly in the background (decoration, hidden from screen readers). |
| `Empty` | The welcome screen: headline, description and three starter questions. Clicking one asks it. Animates in and fades out when the first message is sent (`AnimatePresence`). |
| `Dots` | Three pulsing dots shown while waiting for an answer. |
| `Message` | One chat bubble. User bubbles are right-aligned with a gradient. Bot bubbles have an avatar, the answer text (plain text, line breaks kept) and source chips. The `pending` and `error` kinds change the styling. |
| `App` | Holds the state: `org` (company name), `messages`, `text` (input box), `busy` (request in flight). |
| `App` → `useEffect` hooks | Load the company name on start and set the page title; scroll to the newest message; grow the textarea as you type (max 144 px). |
| `App` → `ask(raw)` | Ignores empty input or calls while busy, adds the question and a pending bubble (`addQuestion`), awaits `sendMessage`, then swaps in the reply (`applyReply`). |
| `App` → `newChat()` | Ignores calls while busy, sets busy (so nothing can be sent during the reset), calls `resetChat`, then clears the messages. |
| `App` → `onKeyDown` | Enter sends; Shift+Enter adds a line; Enter while composing with an input method (for example Japanese or Chinese) does nothing (`isSendKey`). |

**`api.js`**
| Function | What it does |
|---|---|
| `post(url, body)` | Sends JSON with `POST` and returns `{ok, data}`. A non-JSON response becomes `{}`. |
| `sendMessage(message)` | Returns `{answer, sources}` on success, `{error}` with the server's message on failure, or a "Could not reach the server" error if the network fails. |
| `resetChat()` | Calls `/api/reset` and never throws. |
| `getConfig()` | Calls `/api/config` and falls back to `{orgName: "Your Company"}`. |

**`chat.js`**
| Function | What it does |
|---|---|
| `MAX_QUESTION` | 1000, the same limit as the server. |
| `sourceLabel(s)` | `"Leave.pdf, page 3"` or `"Leave.pdf"`. |
| `isSendKey(e)` | True for Enter without Shift and not composing. |
| `addQuestion(messages, id, text)` | Appends the user bubble and the pending bot bubble. |
| `applyReply(messages, id, res)` | Replaces that pending bubble with the answer, or an error bubble. Other bubbles are untouched. |

### 5.3 `server/` (Express API)
| File | What it does |
|---|---|
| `package.json` | Dependencies (`express`, `mongoose`) and scripts: `start`, `dev` (auto-restart), `test`. |
| `.env.example` | Every setting with a comment. Copy it to `.env`. |
| `src/index.js` | Entry point: reads `.env`, warns about unsafe settings, defines the `ChatLog` model with a TTL index, connects to MongoDB (retrying every 30 s if it is down), builds the app with `createApp(...)` and starts listening. |
| `src/app.js` | `createApp(options)`: wires the middleware and routes in a fixed order (see below). |
| `src/handlers.js` | `createHandlers(...)`: the code behind each route. Framework-independent, so it can be tested with plain objects. |
| `src/security.js` | Security helpers, with no dependencies. |
| `src/aiClient.js` | `createAiClient(...)`: makes HTTP calls to the Python service with the session id, the service token and a timeout. |
| `test/*.test.js` | Unit tests (`security`, `handlers`) and an end-to-end test against the real Python service (`e2e`). |

**Middleware order in `app.js`** (each request passes through these from top to bottom):
1. Remove the `X-Powered-By` header (it reveals the framework).
2. Add security headers (`SECURITY_HEADERS`).
3. Session: verify the signed `sid` cookie, or create a new one (`HttpOnly`, `SameSite=Lax`, plus `Secure` if `COOKIE_SECURE=true`).
4. For `/api` requests: block cross-site requests (`isSameOrigin`) and require JSON on `/api/chat` (status 415 otherwise).
5. `express.json({limit: "16kb"})` parses the body.
6. Routes: `GET /api/config`, `POST /api/chat`, `POST /api/reset`; any other `/api/*` URL returns a JSON 404.
7. Serve `client/dist` (the built React app); any other path returns `index.html`.
8. Error handler: always returns JSON and never a stack trace (413 for a body that is too big, 400 for broken JSON).

**`handlers.js`**
| Handler | What it does |
|---|---|
| `config` | Asks the AI service for the company name (the single source of truth); falls back to `ORG_NAME` in `server/.env`. |
| `chat` | Rate limit (429) → validate (400) → call the AI service → on error, pass its message and status through and log it; on success, keep only `answer` and `sources` (with `source` and `location` as strings), log, and respond. Service unreachable → 502; too slow → 504. |
| `reset` | Asks the AI service to forget this session. Always returns `{ok: true}`. |

**`security.js`**
| Function | What it does |
|---|---|
| `newSid()` | 16 random bytes as 32 hex characters. |
| `signSid(sid, secret)` / `verifySid(value, secret)` | Cookie value `sid.signature` using HMAC-SHA256. Verification uses a constant-time compare and rejects anything malformed, so a browser can't invent or copy-edit a session id. |
| `parseCookies(header)` | Turns the `Cookie` header into an object. The first value wins, and bad encoding doesn't crash it. |
| `sessionCookie(value, {secure})` | Builds the `Set-Cookie` text. |
| `hashSid(sid)` | SHA-256 of the session id, stored in MongoDB instead of the id itself. |
| `validateQuestion(body)` | Accepts only `{message: "<string>"}`. Trims it and checks it is not empty and at most 1,000 characters. |
| `createRateLimiter({limit, windowMs})` | Counts requests per key in fixed one-minute windows. Memory is bounded. Used per session (`RATE_LIMIT_PER_MIN`, default 20) and per IP (3× that). |
| `isSameOrigin(origin, host, allowed)` | CSRF protection: a browser POST whose `Origin` is a different site is refused. |
| `parseTrustProxy(value)` | Turns `TRUST_PROXY=1` into the number 1 (a hop count), so the per-IP limit uses the real client IP behind Nginx. |
| `SECURITY_HEADERS` | `Content-Security-Policy` (only this site's scripts; Google Fonts allowed; no framing), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, `Permissions-Policy`. |

### 5.4 `ai-service/` (Python)
| File | What it does |
|---|---|
| `config.py` | Reads every setting from `.env`, with defaults. Validates `EMBED_PROVIDER`, and sets `HISTORY_TURNS` to 0 if a negative value is given. |
| `app.py` | Flask app for Express only (see below). |
| `rag.py` | The answer engine: retrieval, the prompt and per-session memory. |
| `llm.py` | Every call to an AI provider: chat (Grok) and embeddings (keyword, local or OpenAI). Change this file to switch providers. |
| `ingest.py` | Reads `docs/`, cuts documents into chunks, embeds them and builds a new index. |
| `store.py` | Chroma helpers and the atomic index switch. |
| `requirements.txt` / `requirements.lock` | Minimum versions, and exact tested versions. |
| `docs/` | Put company documents here (subfolders are fine). |
| `chroma_db/` | The generated index. Don't edit it by hand. |
| `tests/` | pytest suites: `test_functional.py`, `test_security.py`, `test_loaders.py`; `conftest.py` builds a throwaway index and a fake model; `fake_llm_server.py` runs the real service with that fake model for the Node end-to-end test. |

**`app.py`**
| Function | What it does |
|---|---|
| `check_service_token` | Runs before every request except `/health`. Refuses (403) unless `X-Service-Token` matches `AI_SERVICE_TOKEN`, using a constant-time compare. If no token is configured, it refuses everything (503), however the app was started. |
| `_sid()` | Accepts only session ids made of 16–64 letters, digits, `-` or `_`. |
| `health` | `GET /health` returns `{ok: true}`, for monitoring. |
| `api_config` | `GET /api/config` returns `{orgName}`. |
| `api_chat` | `POST /api/chat`: validates (non-object or non-string bodies get 400, never a crash), calls `rag.ask`, and turns errors into clear messages (setup errors, Zscaler proxy blocks, or "Lookup failed: Type: message"). |
| `api_reset` | `POST /api/reset`: forgets the session. |
| `too_large` | Bodies over 16 KB get a JSON 413. |
| `__main__` | Refuses to start without `AI_SERVICE_TOKEN`; binds to `127.0.0.1:5001` with debug off. |

**`rag.py`**
| Name | What it does |
|---|---|
| `SYSTEM_PROMPT` | The rules given to the model: answer only from the excerpts; never invent numbers, dates, names or links; start with `[[NOT_FOUND]]` if the excerpts don't answer the question; mention conflicts; plain text only. |
| `_history`, `_lock`, `MAX_SESSIONS` | Memory: an ordered dictionary of session → messages, at most 500 sessions, protected by a lock because Flask handles requests on several threads. |
| `_session(id)` | Gets or creates a session's history and marks it as recently used. When full, it drops the least recently used session. |
| `reset(id)` | Deletes a session's history. |
| `_recent(history)` | The last `HISTORY_TURNS` question/answer pairs (nothing if `HISTORY_TURNS` is 0). |
| `_standalone_question(history, q)` | Asks the model to rewrite a follow-up into a full question, using the last 4 messages. Skipped on the first question or when memory is off. |
| `retrieve(query)` | Embeds the query, asks Chroma for the `TOP_K` nearest chunks and keeps those within `MAX_DISTANCE`. Raises a clear error if nothing is indexed. |
| `_label(hit)` | `"source, location"` for the prompt. |
| `ask(id, question)` | The full flow from section 3: rewrite → retrieve → not-found shortcut → prompt → model → sources (de-duplicated, at most 4) → `[[NOT_FOUND]]`/empty handling → save memory. |

**`llm.py`**
| Function | What it does |
|---|---|
| `_get_chat_client()` | Creates the Grok client once, with `LLM_TIMEOUT` (25 s) and one retry. Gives a clear error if `XAI_API_KEY` is missing. |
| `chat(messages)` | Sends messages to `CHAT_MODEL` with `max_tokens=MAX_TOKENS` and returns the reply text. |
| `embed(texts)` | Picks the embedding provider. |
| `_embed_keyword` | Offline: lowercases, drops common words, crudely removes plural "s", adds word pairs, hashes each into one of 4,096 slots, applies log weighting, then scales the result to length 1. |
| `_embed_local` | Chroma's built-in MiniLM model (downloads once). |
| `_embed_openai` | OpenAI embeddings, in batches of 100. |

**`ingest.py`**
| Name | What it does |
|---|---|
| Loaders (`load_pdf` (OCR for scanned pages), `load_docx`, `load_pptx` (including group shapes and notes), `load_excel`, `load_csv`, `load_text`, `load_html`, `load_xml`, `load_json`, `load_rtf`, `load_odf_text`, `load_epub`, `load_eml`, `load_msg`, `load_image` (every page of a multi-page TIFF), `load_legacy_office` (LibreOffice in its own process group, all of it killed after 120 s)) | Each one *yields* `(text, location)` pairs; the location is "page 3", "slide 2", "sheet Claims", "section 4" or empty. Libraries used by only one format are imported inside that loader, so if a library is missing only that format is skipped. |
| `LOADERS` | File extension → loader. 34 extensions: `.pdf .docx .doc .pptx .ppt .xlsx .xlsm .xls .ods .odt .odp .csv .tsv .txt .md .markdown .rst .log .yaml .yml .rtf .html .htm .xml .json .epub .eml .msg .png .jpg .jpeg .tif .tiff .bmp`. |
| `decode_bytes` / `read_text` | Decode text files without losing characters: a UTF-8 or UTF-16 byte-order mark first, then UTF-16 without one, then strict UTF-8, then Windows-1252. |
| `_docx_lines` | Walks the Word file's XML in document order, including content controls, tracked insertions, text boxes and nested tables (flattened into their cell). Deleted text is left out. |
| `_html_to_text` | Takes bytes, so the page's own charset is honoured. Removes `script`/`style` tags and keeps each table row on one line. |
| `_attachments` | Indexes e-mail attachments (`.eml`/`.msg`) with the normal loaders, labelled "attachment <name>". It uses only the attachment's extension, saving the data under a fixed temp name, skips attached e-mails and applies the size cap. |
| `_ocr_available` / `_ocr_image` | Uses OCR only if both `pytesseract` and the Tesseract program are installed. |
| `chunk_text(text)` | Packs whole lines into chunks of about `CHUNK_SIZE` (1,000) characters. It splits a very long line at a sentence end or a space, and starts each chunk with about `CHUNK_OVERLAP` (150) characters from the previous one, so a sentence that falls on a boundary isn't lost. |
| `find_files()` | Every supported file under `docs/`, skipping Office temp files (`~$`), hidden files, and symlinks or anything that resolves outside `docs/`. |
| `collect_records(files)` | Runs the right loader for each file and skips files over `MAX_FILE_MB`. A file that fails partway adds **no** chunks. Prints `+` (indexed) or `!` (skipped, with the reason) for each file. |
| `main()` | Builds a **new** collection, embeds every chunk (with the file name included so titles match), adds them in batches of 500, then switches the service to the new collection. If files exist but **none** could be read, it stops and keeps the old index. Only an empty `docs/` clears the index. |

**`store.py`**
| Function | What it does |
|---|---|
| `new_collection()` | Creates an empty collection with a unique, timestamped name. |
| `activate_collection(c)` | Writes `c`'s name to `chroma_db/ACTIVE` through an atomic file replace, then deletes the older collections. Until this moment the old index keeps answering, and if ingest fails it is never replaced. |
| `get_collection()` | Opens the collection named in `ACTIVE`, re-reading the pointer once if a rebuild has just switched it, so a deleted collection is never recreated by accident. Falls back to `company_policies` for indexes built before this change, or an empty index on first run. |

---

## 6. Security, in plain terms

| Risk | How it is handled |
|---|---|
| Someone pretends to be another user | Session ids are random, kept in an `HttpOnly` cookie (page scripts can't read it) and signed (they can't be forged or changed). |
| Another website makes your browser send questions (CSRF) | `SameSite=Lax` cookies, an `Origin` check, and a JSON-only `/api/chat`. |
| Clickjacking, content sniffing, injected scripts | `X-Frame-Options`, `frame-ancestors 'none'`, `nosniff`, and a strict Content-Security-Policy. |
| Showing malicious text from documents or the model (XSS) | React shows everything as plain text; there is no `dangerouslySetInnerHTML` anywhere. |
| Running up the AI bill or flooding the app | Rate limits per session and per IP, a 1,000-character limit, a 16 KB body limit, model timeouts and a reply length cap. |
| Other programs on the server calling the AI service | It listens on 127.0.0.1 only, requires a shared token and refuses to start without one. |
| Crafted request bodies crashing the service | Strict type checks: anything but `{message: string}` gets a 400. |
| Malicious documents | defusedxml for XML, a size cap, an e-book zip size cap, symlinks not followed, a LibreOffice timeout that kills the whole process group, attachment names never used as file paths, and a failing file skipped cleanly. |
| Leaking internals | No stack traces in responses, no `X-Powered-By`, Flask debug off. |
| Audit data misuse | MongoDB stores a hash of the session id; logs expire after 90 days by default. |
| "Prompt injection" (a question telling the model to ignore its rules) | The question always stays in the user message, separate from the system rules, and the rules forbid using outside knowledge. No prompt can be made fully injection-proof, which is why HR should spot-check important answers. |

Not included yet: user login (SSO). Run the app only on an internal network until authentication is added.

---

## 7. Settings reference

**`ai-service/.env`**: `XAI_API_KEY`, `ORG_NAME`, `AI_SERVICE_TOKEN`, `CHAT_MODEL` (grok-4), `XAI_BASE_URL`, `LLM_TIMEOUT` (25), `MAX_TOKENS` (1024), `EMBED_PROVIDER` (keyword), `OPENAI_API_KEY`, `EMBED_MODEL`, `CHUNK_SIZE` (1000), `CHUNK_OVERLAP` (150), `TOP_K` (5), `MAX_DISTANCE` (0.95 for keyword, otherwise 0.8), `HISTORY_TURNS` (6), `MAX_FILE_MB` (50), `DOCS_DIR`, `CHROMA_DIR`.

**`server/.env`**: `PORT` (5000), `AI_SERVICE_URL`, `ORG_NAME` (fallback), `SESSION_SECRET`, `AI_SERVICE_TOKEN`, `MONGODB_URI`, `COOKIE_SECURE`, `RATE_LIMIT_PER_MIN` (20), `ALLOWED_ORIGINS`, `TRUST_PROXY`, `LOG_RETENTION_DAYS` (90).

---

## 8. Glossary
- **API**: a set of URLs one program calls to ask another program to do something.
- **Chunk**: a piece of a document, about 1,000 characters long.
- **Component (React)**: a function that returns part of the page.
- **Cosine distance**: how different two embeddings are; 0 means identical.
- **CSRF**: a malicious site making your browser send a request to another site.
- **Embedding**: a list of numbers representing a text, so that similar texts are close together.
- **HMAC**: a signature made with a secret key; changing the data breaks the signature.
- **LLM**: large language model, the AI that writes text (here, Grok).
- **Middleware**: a function every request passes through in Express.
- **Prompt**: the text sent to the LLM.
- **RAG**: retrieval-augmented generation (see section 1).
- **State (React)**: data that, when changed, makes React redraw the page.
- **TTL index**: a MongoDB rule that deletes documents automatically after a set time.
- **Vector database**: a database that finds the stored embeddings closest to a given one.
