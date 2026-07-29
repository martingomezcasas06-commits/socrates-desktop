import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import Icon from "../Icon";
import ToolLogo from "../components/ToolLogo";

type Message = { role: "user" | "assistant"; content: string };

const API_URL = import.meta.env.VITE_API_URL as string;

const CHAT_SUGGEST = [
  "How do I write better prompts?",
  "Which tool should I use to summarise a meeting?",
  "Help me get started with my stack",
];

const RECENT_TOPICS = [
  "Writing better prompts",
  "Summarising long documents",
  "Getting started with my stack",
];

const TOOL_GRADIENTS = [
  ["#2E89AE", "#8b5cf6"],
  ["#10b981", "#059669"],
  ["#f59e0b", "#ef4444"],
  ["#3b82f6", "#06b6d4"],
];

function initialsOf(s: string): string {
  const base = s.includes("@") ? s.split("@")[0].replace(/[._-]/g, " ") : s;
  const p = base.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "S";
}

export default function ChatPage({ session }: { session: Session }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi! I'm Socrates. Ask me anything about your AI tools or how to use them." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const initials = initialsOf(session.user?.email ?? "");

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    async function loadTools() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from("users")
        .select("id")
        .eq("auth_id", user.id)
        .single();
      if (!profile) return;
      const { data } = await supabase
        .from("recommendations")
        .select("tool_name")
        .eq("user_id", profile.id)
        .eq("status", "approved")
        .limit(4);
      if (data) setTools((data as { tool_name: string }[]).map((r) => r.tool_name));
    }
    loadTools();
  }, []);

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setBusy(true);

    const next: Message[] = [...messages, { role: "user", content: trimmed }];
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

  function send(e: React.FormEvent) {
    e.preventDefault();
    void sendText(input);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendText(input);
    }
  }

  return (
    <>
      <div className="head">
        <div className="titles">
          <h1>Chat with <span className="ital">Socrates</span></h1>
          <div className="sub">Your always-on AI advisor</div>
        </div>
      </div>

      <div className="chat-layout">
        <div className="chat-main">
          <div className="chat-stream" ref={listRef}>
            {messages.map((m, i) =>
              m.role === "assistant" ? (
                <div key={i} className="msg bot">
                  <div className="av"><Icon name="sparkle" /></div>
                  <div className="bubble">
                    {m.content || <span style={{ opacity: 0.4 }}>thinking…</span>}
                  </div>
                </div>
              ) : (
                <div key={i} className="msg me">
                  <div className="av">{initials}</div>
                  <div className="bubble">{m.content}</div>
                </div>
              )
            )}
            {busy && (
              <div className="msg bot">
                <div className="av"><Icon name="sparkle" /></div>
                <div className="bubble"><span style={{ opacity: 0.4 }}>thinking…</span></div>
              </div>
            )}
          </div>

          <div className="chat-foot">
            <div className="chips">
              {CHAT_SUGGEST.map((c) => (
                <button
                  key={c}
                  className="chip"
                  type="button"
                  disabled={busy}
                  onClick={() => void sendText(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <form className="composer" onSubmit={send}>
              <textarea
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask Socrates anything…"
                disabled={busy}
              />
              <button className="send" type="submit" disabled={!input.trim() || busy}>
                <Icon name="send" />
              </button>
            </form>
          </div>
        </div>

        <aside className="chat-aside">
          <div className="aside-sec">
            <h4>Your tools</h4>
            {(tools.length ? tools : ["ChatGPT", "Claude", "Perplexity", "Notion AI"]).map((t, i) => (
              <div className="aside-tool" key={t + i}>
                <ToolLogo
                  name={t}
                  className="lg"
                  fallbackStyle={{
                    background: `linear-gradient(135deg, ${TOOL_GRADIENTS[i % TOOL_GRADIENTS.length][0]}, ${TOOL_GRADIENTS[i % TOOL_GRADIENTS.length][1]})`,
                  }}
                />
                <span className="nm">{t}</span>
              </div>
            ))}
          </div>
          <div className="aside-sec">
            <h4>Recent topics</h4>
            {RECENT_TOPICS.map((t) => (
              <div className="aside-topic" key={t}>{t}</div>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}
