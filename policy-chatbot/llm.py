"""LLM calls: Grok (xAI) for chat, local or OpenAI for embeddings. Swap this file to change providers."""
from openai import OpenAI

import config

_chat_client = None
_openai_client = None
_local_embedder = None


def _get_chat_client() -> OpenAI:
    global _chat_client
    if _chat_client is None:
        if not config.XAI_API_KEY:
            raise RuntimeError(
                "XAI_API_KEY is missing. Copy .env.example to .env and add your xAI key."
            )
        _chat_client = OpenAI(api_key=config.XAI_API_KEY, base_url=config.XAI_BASE_URL)
    return _chat_client


def embed(texts: list[str], batch_size: int = 100) -> list[list[float]]:
    """Turn a list of texts into a list of embedding vectors."""
    if config.EMBED_PROVIDER == "openai":
        return _embed_openai(texts, batch_size)
    if config.EMBED_PROVIDER == "local":
        return _embed_local(texts)
    return _embed_keyword(texts)


_STOP = set(
    "a an and are as at be by for from has have how i in is it my of on or that the to was "
    "what when where which who will with you your can do does if me we our this there their".split()
)
_DIM = 4096


def _embed_keyword(texts: list[str]) -> list[list[float]]:
    """Offline embedder: hash words (plus word pairs) into a fixed-size vector, L2-normalised."""
    import hashlib
    import math
    import re

    vectors = []
    for text in texts:
        words = [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOP]
        words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words]  # crude plurals
        feats = words + [f"{a}_{b}" for a, b in zip(words, words[1:])]
        counts: dict[int, float] = {}
        for f in feats:
            idx = int(hashlib.md5(f.encode()).hexdigest(), 16) % _DIM
            counts[idx] = counts.get(idx, 0) + 1
        vec = [0.0] * _DIM
        for idx, n in counts.items():
            vec[idx] = 1 + math.log(n)
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        vectors.append([x / norm for x in vec])
    return vectors


def _embed_local(texts: list[str]) -> list[list[float]]:
    global _local_embedder
    if _local_embedder is None:
        from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

        _local_embedder = DefaultEmbeddingFunction()  # small ONNX model, downloads once
    return [[float(x) for x in v] for v in _local_embedder(texts)]


def _embed_openai(texts: list[str], batch_size: int) -> list[list[float]]:
    global _openai_client
    if _openai_client is None:
        if not config.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is missing (needed for EMBED_PROVIDER=openai).")
        _openai_client = OpenAI(api_key=config.OPENAI_API_KEY)
    vectors: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = _openai_client.embeddings.create(model=config.EMBED_MODEL, input=batch)
        vectors.extend(item.embedding for item in response.data)
    return vectors


def chat(messages: list[dict]) -> str:
    """Send chat messages to Grok and return the reply text."""
    response = _get_chat_client().chat.completions.create(
        model=config.CHAT_MODEL,
        messages=messages,
    )
    return (response.choices[0].message.content or "").strip()
