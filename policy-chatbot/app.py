"""Flask web app. Run with:  python app.py   then open http://127.0.0.1:5001"""
import uuid

from flask import Flask, jsonify, render_template, request, session

import config
import rag

app = Flask(__name__)
app.secret_key = config.SECRET_KEY


def session_id() -> str:
    """Each browser gets a random id, stored in a signed cookie."""
    if "sid" not in session:
        session["sid"] = uuid.uuid4().hex
    return session["sid"]


@app.get("/")
def index():
    session_id()
    return render_template("index.html", org_name=config.ORG_NAME)


@app.post("/api/chat")
def api_chat():
    data = request.get_json(silent=True) or {}
    question = (data.get("message") or "").strip()
    if not question:
        return jsonify(error="Type a question first."), 400
    if len(question) > 1000:
        return jsonify(error="Keep your question under 1,000 characters."), 400
    try:
        return jsonify(rag.ask(session_id(), question))
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
    rag.reset(session_id())
    return jsonify(ok=True)


if __name__ == "__main__":
    # Port 5001 because macOS uses 5000 for AirPlay Receiver.
    app.run(debug=True, port=5001)
