# Test report and change log

Date: 2026-10-27 · Branch: `redesign-mern-stack`

**Result: 139 automated tests, all passing.** 100 Python, 30 server (including 6 end-to-end) and 9 client. Two rounds of independent security and functional review confirmed 28 defects, and every one is fixed and covered by a test. Some parts could not be tested in this environment; they are listed in section 4.

---

## 1. How to run the tests

```bash
cd ai-service && .venv/bin/python -m pytest -q tests                  # 100 tests
cd server && PYTHON=../ai-service/.venv/bin/python npm test           # 30 tests (PYTHON enables end-to-end)
cd client && npm test                                                 # 9 tests
```
The Node tests use only Node's built-in test runner, so they run even without `npm install`.

Environment used: macOS, Python 3.9.6 (exact package versions in `ai-service/requirements.lock`), Node 22.23.2. The AI model is replaced by a fake in tests, because no xAI key was available and calls to the provider are blocked by the company proxy.

---

## 2. What was tested

### 2.1 Functional
| Area | What is checked | Where |
|---|---|---|
| Chunking | Size and overlap; a very long line is split; empty text gives no chunks | `ai-service/tests/test_functional.py` |
| File discovery | Office temp files (`~$`), hidden files and symlinks are skipped; files over `MAX_FILE_MB` are skipped | `test_functional.py`, `test_loaders.py` |
| Every file format | PDF (blank or scanned page reported), DOCX (paragraphs, tables, content controls, tracked changes, nested tables, document order), PPTX (slides, tables, notes, group shapes, missing notes body), XLSX/ODS/CSV/TSV, ODT/ODP (document order, lists), RTF, HTML (charset, scripts removed, tables), XML, JSON (key paths), TXT/MD/RST/LOG/YAML, EPUB, EML (plain, HTML, attachments), multi-page TIFF (OCR on every page), image/old `.doc` without OCR/LibreOffice (reported clearly) | `test_loaders.py` |
| Text encodings | UTF-8, UTF-8 with BOM, UTF-16 with and without BOM, Windows-1252 all decode correctly | `test_loaders.py` |
| Index rebuild | A rebuild replaces the index; old collections are removed; a failed embed keeps the old index; if no file can be read the old index is kept; an empty `docs/` clears it; a file failing halfway adds nothing; a stale pointer during a swap doesn't recreate a deleted index | `test_loaders.py`, `test_functional.py` |
| Retrieval | The right document is found; an unrelated question returns the not-found answer without calling the model | `test_functional.py`; also checked on the repo's 6 real documents (42 chunks) |
| Answers | Answer and sources returned; sources de-duplicated and capped at 4; `[[NOT_FOUND]]` stripped and sources dropped; an empty reply becomes the not-found answer; the prompt contains the rules, company name, excerpts and question | `test_functional.py` |
| Memory | Follow-ups rewritten using history; the first question is not rewritten; history trimmed to `HISTORY_TURNS`; `HISTORY_TURNS=0` turns memory off; reset; sessions isolated from each other; at most 500 sessions, least recently used dropped first | `test_functional.py` |
| AI service API | `/health`, `/api/config`, `/api/chat` contract, validation messages (empty, spaces only, missing, 1,000 vs 1,001 characters), setup errors, Zscaler message, other errors shortened, `/api/reset` | `test_functional.py` |
| LLM client | Timeout and one retry set; reply capped by `MAX_TOKENS`; missing key gives a clear error | `test_functional.py`, `test_security.py` |
| Settings | Invalid `EMBED_PROVIDER` stops at startup; mixed case accepted | `test_functional.py` |
| Express handlers | Company name taken from the AI service, with fallback; chat passes the trimmed question and session id; validation errors never reach the AI service; AI errors passed through with their status; unreachable → 502, slow → 504; unexpected response shapes cleaned; reset always OK | `server/test/handlers.test.js` |
| End-to-end | Node handlers + AI client + the **real** Python service: answer with sources, not-found, company name, reset, wrong token refused, forged session id refused | `server/test/e2e.test.js` |
| Client logic | `sendMessage` request format, success, server error, generic error, network failure; `resetChat` never throws; `getConfig` fallback; source labels; Enter / Shift+Enter / input-method composition; pending bubble replaced by the right reply; limit matches the server | `client/test/client.test.js` |
| Live run | AI service started with the real `.env` and index: `/health` OK, missing-key error passed through, calls without the token refused | manual |

### 2.2 Security
| Threat | What is checked | Where |
|---|---|---|
| Session forgery and fixation | Session ids random; cookie signed with HMAC; forged, tampered, wrong-secret, malformed or path-like values rejected; cookie flags `HttpOnly`, `SameSite=Lax`, optional `Secure`; first cookie wins | `server/test/security.test.js` |
| CSRF | Cross-origin POSTs rejected; `null` origin rejected; allow-list works | `security.test.js` |
| Browser hardening | CSP without unsafe scripts, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` | `security.test.js` |
| Abuse and cost | Rate limiter counts, blocks and resets per window, with bounded memory; blocked requests don't reach the AI; `TRUST_PROXY=1` becomes a hop count so the per-IP limit uses real client IPs | `security.test.js`, `handlers.test.js` |
| Input type confusion and injection | Lists, strings, numbers, `null`, broken JSON, numeric message, array message and `{"$gt": ""}` all give 400, never 500, in both Express and Python | `security.test.js`, `ai-service/tests/test_security.py` |
| Oversized bodies | Over 16 KB → 413 | `test_security.py` |
| Service-to-service trust | Missing or wrong token → 403; no token configured → 503 under any launcher; refuses to start without a token; bound to 127.0.0.1 with debug off; invalid session ids (empty, short, `../../etc/passwd`, too long, spaces, `<script>`) rejected | `test_security.py`, `e2e.test.js` |
| Prompt injection | "Ignore all previous instructions..." stays in the user message and is never merged into the system rules | `test_security.py` |
| Hostile documents | XML entity bomb refused; e-book zip bomb refused; symlink to a file outside `docs/` not indexed; attachment named `../../evil name.txt` is saved under a fixed temp name; unsupported attachment types skipped; a hung LibreOffice has its whole process group killed | `test_loaders.py` |
| XSS | No `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in the client; everything is rendered as text | code scan |
| Privacy | Session ids are hashed before logging; logs expire (TTL) | `handlers.test.js`, code review |
| Secrets | `.env` files are git-ignored; staged changes scanned for keys and tokens before commit | manual |

---

## 3. What changed because of testing and review

The app was reviewed twice by independent agents that tried to find defects, followed by agents that tried to disprove each one. Only confirmed findings are listed. 23 claims were rejected, mostly because the restructure had already fixed them.

### 3.1 Found by the tests
| Defect | Fix |
|---|---|
| Removing every document left the old index answering questions | An empty `docs/` now clears the index |
| A list or number as the request body crashed the Python service (500) | Strict type checks return 400 |

### 3.2 Before the reviews: security hardening
| Was | Now |
|---|---|
| Session cookie unsigned; any value accepted | Signed with HMAC, format-checked, `HttpOnly`, `SameSite=Lax`, optional `Secure` |
| No security headers; `X-Powered-By` exposed | CSP, frame denial, `nosniff`, referrer and permissions policies; header removed |
| No CSRF protection beyond SameSite | `Origin` check and JSON-only `/api/chat` |
| No rate limiting | Per session (20/min) and per IP (60/min), configurable |
| No timeouts | AI call 120 s in Express; model 25 s with 1 retry; `max_tokens` cap |
| Errors could be HTML pages with stack traces | JSON-only error handler |
| Python service trusted any local caller | Shared `AI_SERVICE_TOKEN` with a constant-time check |
| Raw session ids would be stored in MongoDB | SHA-256 hash stored instead |
| Security code mixed into one file | Split into dependency-free modules (`security.js`, `handlers.js`, `aiClient.js`, `chat.js`) so it can be tested; `cookie-parser` and `dotenv` dropped |

### 3.3 Review round 1 (17 distinct defects)
| Severity | Defect | Fix |
|---|---|---|
| Medium | Session memory dropped the oldest-created session, so an attacker could push out active users | Least-recently-used eviction with a lock |
| Medium | `HISTORY_TURNS=0` sent the whole history every time and grew memory without limit | 0 now means memory off; values clamped |
| Medium | `TRUST_PROXY=1` was read as an IP address, so everyone shared one rate-limit bucket | Parsed as a hop count |
| Medium | No model timeout or reply cap | `LLM_TIMEOUT`, one retry, `MAX_TOKENS` |
| Medium | `COOKIE_SECURE=true` over plain HTTP silently broke memory | Startup warning and documentation |
| Medium | Symlinks in `docs/` could pull in files from elsewhere | Symlinks and anything resolving outside `docs/` skipped |
| Medium | The header's company name ignored `ai-service/.env` | Read from the AI service; server value is a fallback |
| Medium | "New chat" stayed clickable during a request | Disabled while busy |
| Medium | An empty model reply showed a blank bubble | Replaced by the not-found answer |
| Low | A file failing halfway was partly indexed | Chunks kept only if the whole file loads |
| Low | The index was rebuilt in place, so questions during a rebuild could see half an index | New collection plus an atomic `ACTIVE` pointer switch |
| Low | The service token check was open when the token was blank | Refuses to start without a token |
| Low | Chat logs kept forever; logging off for good if MongoDB was down at start | TTL (`LOG_RETENTION_DAYS`, 90); reconnects every 30 s; state checked on each write |
| Low | Dependencies unpinned | `requirements.lock` with exact versions |
| Low | `md5` fails on FIPS-mode servers | `usedforsecurity=False` (same values, no re-index needed) |
| Low | Sending during "New chat" could be lost | Sending blocked until the reset finishes |
| Low | A mistyped `EMBED_PROVIDER` silently used keyword search | Fails at startup with a clear message |

### 3.4 Review round 2 (11 defects)
| Severity | Defect | Fix |
|---|---|---|
| High | Multi-page TIFF scans: only page 1 was read | Every page is read, labelled "page N" |
| Medium | A rebuild where no file could be read wiped the working index | Ingest stops and keeps the old index |
| Medium | A question arriving during the index swap could recreate a deleted collection | Pointer re-read; a deleted collection is never recreated |
| Medium | Non-UTF-8 text lost accents and euro signs; UTF-16 files became unsearchable | `decode_bytes` (BOM, UTF-16, UTF-8, Windows-1252); HTML uses its own charset |
| Medium | ODT headings were placed after all paragraphs | Read in document order |
| Medium | DOCX missed content controls, nested tables, text boxes and tracked insertions | XML walk in document order |
| Medium | PPTX missed text inside grouped shapes | Group shapes searched |
| Medium | A LibreOffice timeout left helper processes running | Own process group, all of it killed |
| Low | The token check was open when the service was started another way (e.g. `flask run`) | Every request gets 503 when no token is set |
| Low | A PPTX notes page without a body made the whole deck fail | Guarded |
| Low | E-mail attachments were ignored | Attachments indexed with the normal loaders |

### 3.5 Features added on request
- **Document formats:** `ingest.py` went from 7 extensions to 34. See ARCHITECTURE.md section 5.4.
- **Redesign:** React + Framer Motion UI, Express API with optional MongoDB, and the Python service. Behaviour is unchanged, as listed in `context.md` section 3.

---

## 4. Not tested, and why

| Not tested | Why | How to test it |
|---|---|---|
| React rendering, animations and `npm run build`; Express middleware wiring in `server/src/app.js`; `server/src/index.js` startup | npm can't install packages here: the company registry returns 401 and the public registry is blocked by policy. The logic behind them is unit-tested; the wiring and the visuals are not. | After `npm install`: `npm run build`, start both servers, then check the welcome screen, starters, sending, Enter / Shift+Enter, source chips, error bubble, New chat, response headers (`curl -I`), cookie flags, 403 for a foreign `Origin`, 415 for non-JSON, 429 after 20 quick questions |
| MongoDB logging, TTL and reconnect | No MongoDB server or `mongoose` package available | Run MongoDB, ask a question, check the `chatlogs` collection and its `createdAt` TTL index |
| Real answers from Grok | No `XAI_API_KEY`; the proxy blocks the provider | Add the key, ask the starter questions, confirm citations and "not found" for off-topic questions |
| OCR with real Tesseract; LibreOffice conversion of `.doc`/`.ppt` | Neither program is installed (no Homebrew) | Install them, put a scanned PDF and a `.doc` in `docs/`, run `python ingest.py` |
| `.msg` (Outlook) loader | No way to create a sample `.msg` file here | Index a real Outlook message |
| `local` and `openai` embedding providers | Need a model download or an OpenAI key | Set `EMBED_PROVIDER`, re-run ingest, ask questions |
| Load or concurrency testing, accessibility audit | Out of scope for this pass | Load-test with something like k6; audit with Lighthouse or axe |

Known limits that remain by design: there is no login yet, so run the app on an internal network only. Rate limits and session memory live in each process's memory, which suits a single server. Prompt injection can be reduced but not ruled out, so HR should spot-check important answers.
