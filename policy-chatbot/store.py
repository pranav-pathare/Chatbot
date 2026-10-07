"""Chroma vector database, saved to the chroma_db/ folder next to the app."""
import chromadb

import config


def _client():
    return chromadb.PersistentClient(path=str(config.CHROMA_DIR))


def reset_collection():
    """Delete the old index (if any) and return a fresh, empty collection."""
    client = _client()
    try:
        client.delete_collection(config.COLLECTION)
    except Exception:
        pass  # nothing to delete on the first run
    return client.create_collection(config.COLLECTION, metadata={"hnsw:space": "cosine"})


def get_collection():
    return _client().get_or_create_collection(
        config.COLLECTION, metadata={"hnsw:space": "cosine"}
    )
