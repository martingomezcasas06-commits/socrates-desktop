import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

type Message = { role: "user" | "assistant"; content: string };

const API_URL = import.meta.env.VITE_API_URL as string;

export default function ChatPage({ session }: { session: Session }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! I'm Socrates. Ask me anything about your AI tools or how to use them." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);

    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);

    try {
      const res = await fetch(`${API_URL}/api/chat/employee-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
      }

      const reply = await res.text();
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setMessages([...next, { role: "assistant", content: `Error: ${detail}` }]);
    }

    setBusy(false);
  }

  return (
    <div style={styles.wrap}>
      <div ref={listRef} style={styles.messages}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={m.role === "user" ? styles.userBubble : styles.aiBubble}>
              {m.content || <span style={{ opacity: 0.4 }}>thinking…</span>}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={send} style={styles.form}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Socrates anything…"
          style={styles.input}
          disabled={busy}
        />
        <button type="submit" disabled={!input.trim() || busy} style={styles.sendBtn}>↑</button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  messages: { flex: 1, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: 10 },
  userBubble: {
    background: "#312e81",
    color: "#e0e7ff",
    borderRadius: "10px 10px 2px 10px",
    padding: "9px 13px",
    fontSize: 13,
    maxWidth: "80%",
    lineHeight: 1.6,
  },
  aiBubble: {
    color: "#cbd5e1",
    fontSize: 13,
    maxWidth: "90%",
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
  },
  form: {
    display: "flex",
    gap: 8,
    padding: "10px 14px",
    borderTop: "1px solid #1e293b",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 8,
    padding: "9px 12px",
    color: "#f1f5f9",
    fontSize: 13,
    outline: "none",
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    border: "none",
    background: "#6366f1",
    color: "#fff",
    fontSize: 16,
    cursor: "pointer",
    flexShrink: 0,
  },
};
