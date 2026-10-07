"""All settings in one place. Values come from the .env file when present."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = Path(os.getenv("DOCS_DIR", BASE_DIR / "docs"))
CHROMA_DIR = Path(os.getenv("CHROMA_DIR", BASE_DIR / "chroma_db"))
COLLECTION = "company_policies"

ORG_NAME = os.getenv("ORG_NAME", "Your Company")
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")

# Chat model: Grok (xAI). The xAI API is OpenAI-compatible.
XAI_API_KEY = os.getenv("XAI_API_KEY", "")
XAI_BASE_URL = os.getenv("XAI_BASE_URL", "https://api.x.ai/v1")
CHAT_MODEL = os.getenv("CHAT_MODEL", "grok-4")

# Embeddings: xAI has no embeddings endpoint. Options:
#   keyword (default) - offline hashed keyword vectors, no download, no key
#   local             - Chroma's MiniLM model (downloads ~80MB on first use)
#   openai            - OpenAI embeddings (needs OPENAI_API_KEY)
EMBED_PROVIDER = os.getenv("EMBED_PROVIDER", "keyword")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
EMBED_MODEL = os.getenv("EMBED_MODEL", "text-embedding-3-small")  # openai provider only

# Chunking: how documents are cut up before embedding (in characters).
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "1000"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "150"))

# Retrieval: how many chunks to fetch, and how far away (cosine distance,
# 0 = identical) a chunk may be before it is ignored as irrelevant.
TOP_K = int(os.getenv("TOP_K", "5"))
# Keyword vectors score lower similarity than neural ones, so allow a larger distance.
MAX_DISTANCE = float(os.getenv("MAX_DISTANCE", "0.95" if EMBED_PROVIDER == "keyword" else "0.8"))

# Temporary memory: number of past question/answer pairs sent back to the model.
HISTORY_TURNS = int(os.getenv("HISTORY_TURNS", "6"))
