import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getConfig, resetChat, sendMessage } from "./api.js";
import { MAX_QUESTION, addQuestion, applyReply, isSendKey, sourceLabel } from "./chat.js";

const STARTERS = [
  "How many leave days do I get in a year?",
  "How do I request a new laptop or other asset?",
  "What is the work from home policy?",
];

const ease = [0.22, 1, 0.36, 1];

function Orbs() {
  return (
    <div className="orbs" aria-hidden="true">
      <motion.span className="orb o1" animate={{ x: [0, 60, 0], y: [0, 40, 0] }} transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }} />
      <motion.span className="orb o2" animate={{ x: [0, -70, 0], y: [0, -30, 0] }} transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }} />
    </div>
  );
}

function Empty({ onPick }) {
  return (
    <motion.section className="empty" exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }}>
      <motion.h2 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
        Ask about <span className="grad">company policies</span>
      </motion.h2>
      <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.08, ease }}>
        Leave, asset requests, reimbursements and other everyday processes. Answers come with the document they were found in.
      </motion.p>
      <div className="starters">
        {STARTERS.map((q, i) => (
          <motion.button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18 + i * 0.08, ease }}
            whileHover={{ y: -3, scale: 1.015 }}
            whileTap={{ scale: 0.98 }}
          >
            <span>{q}</span>
            <span className="arrow">→</span>
          </motion.button>
        ))}
      </div>
    </motion.section>
  );
}

function Dots() {
  return (
    <span className="dots" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.i key={i} animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
      ))}
    </span>
  );
}

function Message({ m }) {
  if (m.role === "user") {
    return (
      <motion.div className="msg user" layout initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.3, ease }}>
        {m.text}
      </motion.div>
    );
  }
  return (
    <motion.div className={`msg bot ${m.kind || ""}`} layout initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }}>
      <div className="avatar" aria-hidden="true">P</div>
      <div className="card">
        <div className="body">
          {m.kind === "pending" && <Dots />}
          {m.text}
        </div>
        {m.sources?.length > 0 && (
          <div className="chips" aria-label="Sources">
            {m.sources.map((s, i) => (
              <motion.span key={i} className="chip" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 + i * 0.07 }}>
                {sourceLabel(s)}
              </motion.span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function App() {
  const [org, setOrg] = useState("Your Company");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const nextId = useRef(0);

  useEffect(() => {
    getConfig().then((c) => {
      setOrg(c.orgName);
      document.title = `${c.orgName} policy assistant`;
    });
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 144) + "px";
  }, [text]);

  async function ask(raw) {
    const q = raw.trim();
    if (!q || busy) return;
    const pendingId = ++nextId.current;
    setBusy(true);
    setText("");
    setMessages((m) => addQuestion(m, pendingId, q));
    const res = await sendMessage(q);
    setMessages((m) => applyReply(m, pendingId, res));
    setBusy(false);
    inputRef.current?.focus();
  }

  async function newChat() {
    if (busy) return;
    setBusy(true); // also blocks sending until the server has forgotten the old chat
    await resetChat();
    setMessages([]);
    setBusy(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (isSendKey({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
      e.preventDefault();
      ask(text);
    }
  }

  return (
    <div className="app">
      <Orbs />
      <motion.header initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.5, ease }}>
        <div className="wrap bar">
          <div className="brand">
            <div className="logo">P</div>
            <div>
              <h1>{org}</h1>
              <p>Policy assistant</p>
            </div>
          </div>
          <motion.button type="button" className="ghost" onClick={newChat} disabled={busy} whileHover={busy ? {} : { scale: 1.04 }} whileTap={busy ? {} : { scale: 0.96 }}>
            New chat
          </motion.button>
        </div>
      </motion.header>

      <main ref={logRef}>
        <div className="wrap col" role="log" aria-live="polite">
          <AnimatePresence mode="wait">{messages.length === 0 && <Empty key="empty" onPick={ask} />}</AnimatePresence>
          {messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
        </div>
      </main>

      <footer>
        <div className="wrap">
          <form onSubmit={(e) => { e.preventDefault(); ask(text); }} autoComplete="off">
            <textarea
              ref={inputRef}
              rows={1}
              maxLength={MAX_QUESTION}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Your question"
              placeholder="Ask about leave, assets, benefits..."
            />
            <motion.button type="submit" className="send" disabled={busy} whileHover={busy ? {} : { scale: 1.05 }} whileTap={busy ? {} : { scale: 0.94 }}>
              Send
            </motion.button>
          </form>
          <p className="note">Answers come from the documents your company has uploaded. For anything important, confirm with HR.</p>
        </div>
      </footer>
    </div>
  );
}
