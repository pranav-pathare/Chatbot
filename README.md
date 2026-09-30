# Building an Internal Organization Chatbot — Complete Guide
### From Requirements to a Working, Deployed System

This guide walks through the entire lifecycle of building an internal
policy/knowledge chatbot: gathering requirements, choosing technology,
building the core pipeline, testing it, and scaling it up to a web app
a whole organization can use.

It assumes the scenario already scoped out: a **self-hosted (localhost/
on-prem) chatbot**, serving **50–500 employees**, reading policy
documents in **docx, pdf, and pptx** format, with **no fixed LLM
preference** — so it's written to be flexible on that last point.

---

## 1. Requirements Gathering

Before writing any code, pin down these five questions — they determine
almost every technology choice that follows.

| Question | Why it matters | This project's answer |
|---|---|---|
| Where does it run? | Cloud vs. on-prem changes auth, networking, and cost model | Localhost / on-prem |
| How many users? | Determines concurrency handling and hardware sizing | 50–500 |
| Which LLM? | API (fast to build, data leaves network) vs. local model (private, needs GPU) | Open — supports both |
| What documents? | Determines which parsers you need | docx, pdf, pptx |
| Is access scoped? | Some policies may be team-restricted | Not yet — flagged as a v2 item |

**Other questions worth asking your own stakeholders before you start:**
- Will documents change frequently, or is this mostly static reference material?
- Do employees need to see *which* document an answer came from (citations)?
- Is there a compliance/legal requirement around data residency?
- Who owns keeping the source documents up to date?

---

## 2. Technology Stack

### 2.1 Document Processing
| Tool | Purpose |
|---|---|
| `python-docx` | Extract text, headings, and tables from Word docs |
| `pypdf` | Extract text page-by-page from PDFs |
| `python-pptx` | Extract slide text and speaker notes from PowerPoint |
| `pytesseract` + Tesseract OCR *(optional)* | Only needed if any PDFs are scanned images |

### 2.2 Embeddings & Retrieval
| Tool | Purpose |
|---|---|
| `sentence-transformers` | Generates embeddings locally — no data leaves the machine |
| `numpy` | Cosine similarity search over embeddings |
| Qdrant / Chroma / FAISS *(scale-up option)* | Swap in if the document set grows into the thousands |

### 2.3 LLM (generation layer — pick one)
| Option | Pros | Cons |
|---|---|---|
| **Ollama** (e.g. Llama 3.1) | Fully local, no API key, no data leaves network | Needs a GPU for good response times at 50–500 users |
| **Anthropic API** (Claude) | No GPU needed, strong answer quality | Query text leaves the network — check data policy |
| **OpenAI API** (GPT) | Same trade-off as above | Same trade-off as above |

### 2.4 Backend (for the web version)
- **Python 3.10+**
- **FastAPI** — REST API framework
- **Uvicorn** — ASGI server
- **Redis + Celery** — request queuing under concurrent load
- **requests** — HTTP calls to Ollama's local API

### 2.5 Frontend (for the web version)
- **React** (or **Streamlit/Gradio** for a faster first version)
- **Node.js + npm** — if using React

### 2.6 Auth & Access Control
- SSO/LDAP integration (via your org's identity provider's SDK, or `python-ldap`)

### 2.7 Infrastructure
- **Docker + Docker Compose** — containerize every service
- **Server/VM**: 16–32GB RAM, 8+ CPU cores minimum; GPU (RTX 4090 class+) only if self-hosting the LLM
- **Nginx** *(optional)* — reverse proxy for internal network serving

### 2.8 Monitoring
- Python `logging` or Loguru for query/response logs
- Grafana + Prometheus, or simple uptime checks, for service health

---

## 3. Architecture Overview

```
        data/ (docx, pdf, pptx, txt)
              |
              v
        ┌─────────────┐
        │  ingest.py   │  → extracts text + page/slide/section metadata
        └─────────────┘
              |
              v
        ┌─────────────┐
        │ chunker.py   │  → splits into ~200-word chunks, links neighbors
        └─────────────┘
              |
              v
        ┌──────────────┐
        │ vectorstore.py│ → embeds chunks locally, stores in ./index/
        └──────────────┘
              |
   query -----+----- top-k relevant chunks + neighbors
              |
              v
        ┌──────────────┐
        │ llm_backend.py│ → builds prompt, calls Ollama/Claude/OpenAI
        └──────────────┘
              |
              v
        Answer + source citation, returned to employee
```

The "broader context" behavior — the thing you specifically asked for —
comes from two mechanisms working together:

1. **Neighbor expansion**: when a chunk matches a query, the chunk
   immediately before and after it *in the same document* is pulled in
   too, so a policy that spans two paragraphs or two slides doesn't come
   back truncated mid-thought.
2. **System prompt instruction**: the LLM is explicitly told to explain
   the full policy, not just answer the narrow question, and to always
   cite its source document + page/slide/section.

---

## 4. Build Steps (CLI Prototype — Working Today)

This is the version already built and tested. Each step below can be
run and verified independently before moving to the next.

### Step 1 — Project structure
```
org-chatbot/
  data/              <- drop organization documents here
  index/             <- generated automatically, holds the search index
  ingest.py
  chunker.py
  vectorstore.py
  llm_backend.py
  build_index.py
  chat.py
  requirements.txt
  README.md
```

### Step 2 — Install dependencies
```bash
pip install -r requirements.txt
```

### Step 3 — Document ingestion (`ingest.py`)
- Walks the `data/` folder recursively.
- Routes each file to the right parser by extension (docx/pdf/pptx/txt).
- Returns a list of "sections": `{text, source filename, location}`
  where location is a heading, page number, or slide number.
- **Verified**: tested against sample docx (headings + tables), pptx
  (slides + speaker notes), and txt files — all extracted cleanly with
  correct metadata attached.

### Step 4 — Chunking (`chunker.py`)
- Splits long sections into ~220-word chunks with 40-word overlap, so
  no single chunk is too large for the embedding model or too small to
  carry meaning.
- Links each chunk to its `prev_id` / `next_id` **within the same
  document**, which is what powers the neighbor-expansion step later.
- **Verified**: confirmed slide 1 and slide 2 of a test pptx were
  correctly linked as neighbors.

### Step 5 — Embedding & vector store (`vectorstore.py`)
- Uses `sentence-transformers` (`all-MiniLM-L6-v2`) to embed every
  chunk locally — no API calls, nothing leaves the machine.
- Stores vectors as a `.npy` file and chunk metadata as `.json` in
  `index/`.
- At query time, embeds the question and does a cosine-similarity
  search to find the top-k most relevant chunks.
- Includes `expand_with_neighbors()` to pull in surrounding chunks for
  the "broader context" behavior.
- **Verified**: full build → save → load → search → neighbor-expand
  cycle tested end-to-end with a stand-in embedder (the real
  `sentence-transformers` model needs one-time internet access to
  download from Hugging Face, which will work normally on your own
  machine).

### Step 6 — LLM backend (`llm_backend.py`)
- Pluggable via an `LLM_BACKEND` environment variable: `ollama`,
  `anthropic`, or `openai`.
- Builds a single prompt combining the system instructions, the
  retrieved context chunks (with their source labels), and the
  employee's question.
- **Verified**: all three backend functions are syntactically correct
  and import cleanly; actual API calls need your chosen credentials/
  local Ollama install to test live.

### Step 7 — Build the index
```bash
python3 build_index.py
```
This reads everything in `data/`, chunks it, embeds it, and saves the
index. Re-run this anytime documents are added, removed, or edited.

### Step 8 — Chat
```bash
export LLM_BACKEND=ollama   # or anthropic / openai
python3 chat.py
```
This loads the index, and for every question: retrieves relevant
chunks, expands with neighbors, and asks the LLM to produce a full
explanatory answer with a citation.

### Step 9 — Validate with real documents
Before rolling out, test with a sample of your actual policy documents
and a list of real questions employees are likely to ask. Check:
- Are answers citing the correct source and location?
- Does the neighbor expansion correctly capture split policies?
- Are there any documents/formats that failed to parse (check the
  "skipped" output from `build_index.py`)?

---

## 5. Scaling Up: From CLI to Web App (Next Stage)

Once the CLI version answers correctly on your real documents, wrap it
in a web service so the whole organization can use it through a
browser instead of a terminal.

### Step 10 — Backend API (FastAPI)
Wrap the existing `search()` + `expand_with_neighbors()` +
`generate_answer()` functions behind three endpoints:
- `POST /chat` — takes a question, returns an answer + sources
- `POST /upload` — lets an admin add new documents to `data/` and
  triggers `build_index.py`
- `GET /health` — basic uptime check

### Step 11 — Add concurrency handling
Introduce Redis + Celery so LLM generation (the slowest step) doesn't
block the API when multiple employees ask questions at once. Queue
requests and return results asynchronously to the frontend.

### Step 12 — Frontend
Build a simple chat UI (React, or Streamlit/Gradio for a quicker
first pass) that:
- Sends questions to `/chat`
- Displays the answer with source citations
- Keeps a per-session conversation history

Add a lightweight admin panel for uploading new documents and viewing
ingestion status, backed by `/upload`.

### Step 13 — Authentication
Put SSO/LDAP in front of the app so only employees can access it. If
some policies are meant to be restricted to certain teams, this is
also where you'd add a `allowed_groups` field to chunk metadata and
filter search results by the logged-in user's group.

### Step 14 — Containerize and deploy
- Write a `Dockerfile` per service (ingestion/index-builder, backend,
  frontend) and a `docker-compose.yml` tying them together.
- Provision the on-prem/localhost server: 16–32GB RAM, 8+ CPU cores;
  add a GPU if self-hosting the LLM via Ollama.
- Put Nginx in front if serving over the internal network with a
  friendly URL.

### Step 15 — Monitoring & feedback loop
- Log every question/answer pair (for auditing and for spotting gaps
  in the document set).
- Add a thumbs up/down on each answer in the UI, feeding back into a
  backlog for document or retrieval improvements.
- Set up basic uptime monitoring.

---

## 6. Suggested Team Task Split (10 people)

For a group tackling steps 10–15 in parallel:

1. **Project Lead/Architect** — coordinates integration, owns the
   pipeline contract between modules
2. **Document Ingestion Engineer** — owns `ingest.py`, edge cases
   (scanned PDFs, tables, embedded images)
3. **Chunking & Metadata Engineer** — owns `chunker.py`, re-indexing on
   document updates
4. **Embedding & Vector DB Engineer** — owns `vectorstore.py`, retrieval
   accuracy tuning
5. **LLM/RAG Engineer** — owns `llm_backend.py`, prompt tuning,
   hallucination control
6. **Backend Engineer** — owns the FastAPI service, Redis/Celery queuing
7. **Frontend Engineer (Chat UI)** — owns the employee-facing chat
   interface
8. **Frontend Engineer (Admin Panel)** — owns document upload/re-index
   UI and feedback collection
9. **DevOps/Infra Engineer** — owns Docker, server provisioning, SSO,
   monitoring
10. **QA/Documentation Lead** — owns end-to-end testing and both
    user-facing and internal documentation

**Sequencing**: roles 2–5 (the pipeline) can start immediately since
they don't depend on each other. Role 6 can scaffold against mocked
data early. Roles 7–8 can build against a mocked API before the real
one is ready. Roles 9–10 run continuously throughout.

---

## 7. Known Limitations to Plan For

- **No access control in the CLI version** — anyone running it can
  query all ingested documents. Needed before a multi-team rollout if
  any policies are team-restricted.
- **Scanned/image PDFs won't extract text** — add OCR (`pytesseract`)
  to `ingest.py`'s `load_pdf()` if this applies to any of your source
  documents.
- **Full re-index on every update** — fine at the scale of a typical
  internal policy folder, but if the document set grows very large,
  consider incremental re-indexing (only re-embed changed files).
- **Ollama at 500 users needs a real GPU** — CPU-only local inference
  will feel slow under concurrent load; budget for this if going the
  fully-local route.

---

## 8. Quick Reference — Commands

```bash
# One-time setup
pip install -r requirements.txt

# Whenever documents change
python3 build_index.py

# Start chatting (pick a backend)
export LLM_BACKEND=ollama        # fully local
export LLM_BACKEND=anthropic     # needs ANTHROPIC_API_KEY
export LLM_BACKEND=openai        # needs OPENAI_API_KEY
python3 chat.py
```
