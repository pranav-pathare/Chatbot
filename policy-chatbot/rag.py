"""Answer engine: find relevant policy chunks, then ask the model to answer from them.

Memory is temporary: each browser session keeps its recent questions and answers
in a Python dict. It is cleared when the server restarts or when "New chat" is used.
"""
import config
from llm import chat, embed
from store import get_collection

NOT_FOUND = "[[NOT_FOUND]]"

SYSTEM_PROMPT = f"""You are the internal policy assistant for employees of {config.ORG_NAME}.

Rules:
- Answer ONLY from the policy excerpts provided with each question. Never use outside knowledge for policy details.
- Never invent numbers, dates, eligibility rules, names or links. If an excerpt does not state it, do not state it.
- If the excerpts do not contain the answer, start your reply with {NOT_FOUND} and then say you could not find it in the company documents and suggest the employee contact HR or the relevant team.
- If excerpts disagree, say so and mention both documents.
- Write in plain text with no markdown. Keep answers short. For steps or lists, put each item on its own line starting with a hyphen.
- You may mention the document name when it helps, for example "According to the Leave Policy...".
"""

MAX_SESSIONS = 500
_history: dict[str, list[dict]] = {}


def _session(session_id: str) -> list[dict]:
    if session_id not in _history:
        if len(_history) >= MAX_SESSIONS:  # keep memory bounded: drop the oldest session
            _history.pop(next(iter(_history)))
        _history[session_id] = []
    return _history[session_id]


def reset(session_id: str) -> None:
    _history.pop(session_id, None)


def _standalone_question(history: list[dict], question: str) -> str:
    """Turn a follow-up like 'and for contractors?' into a self-contained question."""
    if not history:
        return question
    recent = "\n".join(f"{m['role'].title()}: {m['content']}" for m in history[-4:])
    prompt = (
        "Rewrite the latest question so it can be understood on its own, using the "
        "conversation for context. Return only the rewritten question.\n\n"
        f"Conversation:\n{recent}\n\nLatest question: {question}"
    )
    return chat([{"role": "user", "content": prompt}]) or question


def retrieve(query: str) -> list[dict]:
    collection = get_collection()
    if collection.count() == 0:
        raise RuntimeError(
            "No documents are indexed yet. Add files to the docs/ folder and run: python ingest.py"
        )
    result = collection.query(
        query_embeddings=embed([query]),
        n_results=config.TOP_K,
        include=["documents", "metadatas", "distances"],
    )
    hits = []
    for text, meta, distance in zip(
        result["documents"][0], result["metadatas"][0], result["distances"][0]
    ):
        if distance <= config.MAX_DISTANCE:
            hits.append(
                {"text": text, "source": meta["source"], "location": meta.get("location", "")}
            )
    return hits


def _label(hit: dict) -> str:
    return f"{hit['source']}, {hit['location']}" if hit["location"] else hit["source"]


def ask(session_id: str, question: str) -> dict:
    history = _session(session_id)
    hits = retrieve(_standalone_question(history, question))

    if not hits:
        answer = (
            "I could not find that in the company documents. "
            "Please contact HR or the relevant team."
        )
        sources = []
    else:
        context = "\n\n".join(f"[{i}] ({_label(h)})\n{h['text']}" for i, h in enumerate(hits, 1))
        messages = (
            [{"role": "system", "content": SYSTEM_PROMPT}]
            + history[-config.HISTORY_TURNS * 2 :]
            + [{"role": "user", "content": f"Policy excerpts:\n{context}\n\nQuestion: {question}"}]
        )
        answer = chat(messages)

        sources, seen = [], set()
        for h in hits:
            key = (h["source"], h["location"])
            if key not in seen:
                seen.add(key)
                sources.append({"source": h["source"], "location": h["location"]})
        sources = sources[:4]

        if answer.startswith(NOT_FOUND):  # the model says the excerpts don't cover it
            answer = answer.removeprefix(NOT_FOUND).strip()
            sources = []

    history.append({"role": "user", "content": question})
    history.append({"role": "assistant", "content": answer})
    del history[: -config.HISTORY_TURNS * 2]  # keep only the most recent turns
    return {"answer": answer, "sources": sources}
