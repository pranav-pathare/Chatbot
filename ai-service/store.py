"""Chroma vector database, saved to the chroma_db/ folder next to the app.

Each ingest builds a new collection, then writes its name to chroma_db/ACTIVE.
The service always reads the collection named there, so a rebuild in progress
is never visible and a failed rebuild leaves the old index in place.
"""
import os
import time

import chromadb

import config

POINTER = "ACTIVE"
SPACE = {"hnsw:space": "cosine"}


def _client():
    return chromadb.PersistentClient(path=str(config.CHROMA_DIR))


def _pointer_path():
    return config.CHROMA_DIR / POINTER


def _active_name() -> str:
    try:
        return _pointer_path().read_text().strip() or config.COLLECTION
    except FileNotFoundError:
        return config.COLLECTION  # indexes built before this change


def new_collection():
    """A fresh, empty collection with a unique name. Not used until activated."""
    return _client().create_collection(f"{config.COLLECTION}_{time.time_ns()}", metadata=SPACE)


def activate_collection(collection) -> None:
    """Point the service at `collection`, then delete every other index collection."""
    tmp = _pointer_path().with_suffix(".tmp")
    tmp.write_text(collection.name)
    os.replace(tmp, _pointer_path())  # atomic: readers see the old or the new name, never half
    client = _client()
    for c in client.list_collections():
        name = c if isinstance(c, str) else c.name
        if name.startswith(config.COLLECTION) and name != collection.name:
            client.delete_collection(name)


def get_collection():
    client = _client()
    for _ in range(2):  # a rebuild may switch ACTIVE between reading it and opening the collection
        try:
            return client.get_collection(_active_name())
        except Exception:
            continue
    # No index yet (first run): an empty collection makes rag.retrieve say "No documents are indexed".
    return client.get_or_create_collection(config.COLLECTION, metadata=SPACE)
