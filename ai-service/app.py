"""Internal RAG service. Called only by the Express API, never by the browser.

Run with:  python app.py   (listens on 127.0.0.1:5001)
"""
import hmac
import re

from flask import Flask, jsonify, request

import config
import rag

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024  # a question is at most 1,000 characters

SID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


@app.before_request
def check_service_token():
    """Only the Express API knows AI_SERVICE_TOKEN, so other local processes can't call us."""
    if request.path == "/health":
        return None
    if not config.AI_SERVICE_TOKEN:  # fail closed, however the app was started
        return jsonify(error="AI_SERVICE_TOKEN is not set on the AI service. See README."), 503
    sent = request.headers.get("X-Service-Token", "")
    if not hmac.compare_digest(sent.encode(), config.AI_SERVICE_TOKEN.encode()):
        return jsonify(error="Forbidden."), 403
    return None


def _sid():
    sid = (request.headers.get("X-Session-Id") or "").strip()
    return sid if SID_PATTERN.match(sid) else None


@app.errorhandler(413)
def too_large(_error):
    return jsonify(error="Keep your question under 1,000 characters."), 413


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.get("/api/config")
def api_config():
    return jsonify(orgName=config.ORG_NAME)


@app.post("/api/chat")
def api_chat():
    sid = _sid()
    if not sid:
        return jsonify(error="Missing session id."), 400
    data = request.get_json(silent=True)
    message = data.get("message") if isinstance(data, dict) else None
    question = message.strip() if isinstance(message, str) else ""
    if not question:
        return jsonify(error="Type a question first."), 400
    if len(question) > 1000:
        return jsonify(error="Keep your question under 1,000 characters."), 400
    try:
        return jsonify(rag.ask(sid, question))
    except RuntimeError as error:  # setup problems: missing API key, nothing indexed
        return jsonify(error=str(error)), 500
    except Exception as error:
        app.logger.exception("Chat request failed")
        if "Zscaler" in str(error) or type(error).__name__ == "PermissionDeniedError":
            return jsonify(
                error="The AI provider is blocked by the company network proxy (Zscaler). "
                "Use an approved LLM endpoint or request an exception."
            ), 500
        # Show the real cause (e.g. bad API key, unknown model) so setup problems are visible.
        return jsonify(error=f"Lookup failed: {type(error).__name__}: {str(error)[:300]}"), 500


@app.post("/api/reset")
def api_reset():
    sid = _sid()
    if sid:
        rag.reset(sid)
    return jsonify(ok=True)


if __name__ == "__main__":
    if not config.AI_SERVICE_TOKEN:
        raise SystemExit(
            "AI_SERVICE_TOKEN is not set. Put the same long random value in ai-service/.env "
            "and server/.env (for example: python -c \"import secrets; print(secrets.token_hex(32))\")."
        )
    app.run(host="127.0.0.1", port=5001, debug=False)
