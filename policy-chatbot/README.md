# Company policy chatbot

An internal chatbot that answers employee questions (leave, asset requests, and so on)
using your own PDF, Word and Excel documents. Each answer shows the document it came from.

Stack: Flask, Chroma (local vector database), Grok / xAI (answers) and offline keyword embeddings.
Memory is temporary: recent messages are kept in a Python dict and reset when the server restarts.

## How it works

```
docs/ (PDF, DOCX, XLSX, CSV, TXT)
   |  python ingest.py   (run once, and again whenever documents change)
   v
cut into chunks -> embeddings -> chroma_db/

Employee question
   -> rag.py: embed the question, fetch the closest chunks from Chroma
   -> send the chunks plus recent chat history to the model
   -> answer plus source tags -> chat page
```

## Setup (macOS / Linux)

```bash
cd policy-chatbot
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env               # then open .env and add your XAI_API_KEY and ORG_NAME
```

1. Put your documents in the `docs/` folder (subfolders are fine).
2. Build the index: `python ingest.py`
3. Start the app: `python app.py`
4. Open http://127.0.0.1:5001

The app uses port 5001 because macOS already uses 5000 for AirPlay Receiver.

## Files

| File | What it does |
| --- | --- |
| `app.py` | Flask routes: chat page, `/api/chat`, `/api/reset` |
| `rag.py` | Retrieval, prompt, temporary session memory |
| `ingest.py` | Reads documents, chunks them, embeds, saves to Chroma |
| `llm.py` | Grok chat + embedding calls (change this file to use another provider) |
| `store.py` | Chroma database helpers |
| `config.py` | Settings, read from `.env` |
| `templates/index.html` | Chat page |

## Tuning (all optional, set in `.env`)

| Setting | Default | When to change it |
| --- | --- | --- |
| `CHAT_MODEL` | `grok-4` | Any Grok model on your xAI account. If you see "model not found", set a current one here. |
| `EMBED_PROVIDER` | `keyword` | `keyword` (offline, no download), `local` (MiniLM model download) or `openai` (needs `OPENAI_API_KEY`). Re-run ingest after changing. |
| `EMBED_MODEL` | `text-embedding-3-small` | OpenAI provider only. Re-run ingest if changed. |
| `TOP_K` | 5 | Raise it if answers miss details that are in the documents. |
| `MAX_DISTANCE` | 0.8 | Lower it (0.6 to 0.7) if the bot answers questions your documents don't cover. |
| `CHUNK_SIZE` | 1000 | Characters per chunk. Re-run ingest after changing. |
| `HISTORY_TURNS` | 6 | How many past question and answer pairs the bot remembers per chat. |

## Known limits

- Scanned PDFs (images of pages) have no text. Ingest will warn you; run OCR on them first.
- Word tables are read row by row without merged-cell handling. Check important tables.
- Memory is per browser session and disappears on restart. Persistent history would need SQLite.
- There is no login. Run it on an internal network, or add authentication before sharing widely.
- The bot only answers from the documents, but always have HR spot-check answers on key policies.
- `python app.py` uses Flask's development server. For real deployment, use gunicorn behind your company's proxy.
