"""Starts the real Flask service on a temp index with a fake LLM. Used by server/test/e2e.test.js.

Usage: python tests/fake_llm_server.py <port>
"""
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import conftest  # noqa: E402  sets env vars and paths

conftest.build_index()

import app  # noqa: E402
import rag  # noqa: E402

rag.chat = conftest.FakeLLM("You get 24 days of paid annual leave.")
app.app.run(host="127.0.0.1", port=int(sys.argv[1]))
