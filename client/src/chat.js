// Pure chat helpers used by App.jsx (no React), so they can be unit tested.
export const MAX_QUESTION = 1000;

export const sourceLabel = (s) => (s.location ? `${s.source}, ${s.location}` : s.source);

// Enter sends, Shift+Enter adds a new line, and Enter while an IME is composing does nothing.
export const isSendKey = (e) => e.key === "Enter" && !e.shiftKey && !e.isComposing;

export function addQuestion(messages, id, text) {
  return [
    ...messages,
    { id: `u${id}`, role: "user", text },
    { id: `b${id}`, role: "bot", kind: "pending", text: "Searching the policies..." },
  ];
}

export function applyReply(messages, id, res) {
  const reply = res.error ? { kind: "error", text: res.error } : { text: res.answer, sources: res.sources };
  return messages.map((m) => (m.id === `b${id}` ? { id: m.id, role: "bot", ...reply } : m));
}
