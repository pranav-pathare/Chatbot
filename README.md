# Company policy chatbot (MERN + Python)

Answers employee questions from your own documents (PDF, Word, PowerPoint, Excel, OpenDocument, HTML, e-mail, text and more) and shows the source of each answer.

- [ARCHITECTURE.md](ARCHITECTURE.md): how it is built and what every file does
- [context.md](context.md): rules to keep when changing it (read this first)
- [TESTING.md](TESTING.md): what has been tested and what changed

Stack: React + Vite + Framer Motion · Express (Node 21.7+) · MongoDB (optional chat log) · Python 3.9+ (Flask, Chroma, Grok/xAI).

## Setup

Create one shared secret and use it in both `.env` files as `AI_SERVICE_TOKEN`:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

```bash
# 1. Python AI service
cd ai-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.lock        # exact tested versions (or requirements.txt)
cp .env.example .env                    # set XAI_API_KEY, ORG_NAME, AI_SERVICE_TOKEN
# put documents in docs/, then:
python ingest.py                        # re-run whenever documents change
python app.py                           # http://127.0.0.1:5001 (internal only)

# 2. Express API (new terminal)
cd server
cp .env.example .env                    # set AI_SERVICE_TOKEN (same value), SESSION_SECRET
npm install && npm start                # http://localhost:5000

# 3. React UI (new terminal)
cd client
npm install && npm run dev              # http://localhost:5173
```
For production, run `cd client && npm run build`; Express then serves the built app on port 5000. Put it behind HTTPS and set `COOKIE_SECURE=true` and `TRUST_PROXY=1`.

Optional extras for ingest: install Tesseract and `pip install pytesseract` to read scanned PDFs and images, and LibreOffice to read old `.doc`/`.ppt` files.

## Tests
```bash
cd ai-service && python -m pytest -q tests
cd server && PYTHON=../ai-service/.venv/bin/python npm test   # PYTHON enables the end-to-end tests
cd client && npm test
```

Tuning options (`CHAT_MODEL`, `EMBED_PROVIDER`, `TOP_K`, `MAX_DISTANCE`, `CHUNK_SIZE`, `HISTORY_TURNS`, and others) are listed in ARCHITECTURE.md section 7.
