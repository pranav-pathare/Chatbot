"""Test setup: a throwaway docs/ folder and Chroma index, offline keyword embeddings, no real LLM."""
import os
import sys
import tempfile
from pathlib import Path

import pytest

TMP = Path(tempfile.mkdtemp(prefix="policy-tests-"))
os.environ.update(
    DOCS_DIR=str(TMP / "docs"),
    CHROMA_DIR=str(TMP / "chroma"),
    EMBED_PROVIDER="keyword",
    XAI_API_KEY="",
    AI_SERVICE_TOKEN="test-token",
    ORG_NAME="Acme",
    HISTORY_TURNS="2",
)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402
import ingest  # noqa: E402
import rag  # noqa: E402

DOCS = {
    "Leave Policy.md": "Annual leave\nEmployees get 24 days of paid annual leave per calendar year.\n"
    "Unused leave up to 5 days can be carried forward to the next year.",
    "Asset Policy.txt": "Laptop requests\nTo request a new laptop raise a ticket in the IT asset portal "
    "and get approval from your manager.",
    "Holidays.csv": "Date,Holiday\n2026-01-26,Republic Day\n2026-08-15,Independence Day\n",
    "~$Leave Policy.md": "office temp file, must be skipped",
    ".hidden.txt": "hidden file, must be skipped",
}


def build_index(docs=DOCS):
    config.DOCS_DIR.mkdir(parents=True, exist_ok=True)
    for f in config.DOCS_DIR.iterdir():
        f.unlink()
    for name, text in docs.items():
        (config.DOCS_DIR / name).write_text(text)
    ingest.main()


@pytest.fixture(scope="session", autouse=True)
def index():
    build_index()


class FakeLLM:
    """Stands in for llm.chat. Records every call; returns a fixed reply."""

    def __init__(self, reply="You get 24 days of paid annual leave."):
        self.reply = reply
        self.calls = []

    def __call__(self, messages):
        self.calls.append(messages)
        return self.reply


@pytest.fixture
def llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(rag, "chat", fake)
    rag._history.clear()
    return fake


@pytest.fixture
def client():
    import app

    return app.app.test_client()


SID = "a" * 32
HEADERS = {"X-Session-Id": SID, "X-Service-Token": "test-token"}
