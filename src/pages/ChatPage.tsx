/**
 * One chat with Socrates. A new chat shows the empty state; the first message
 * creates the conversation (lib/chats.ts) and the thread takes over, with the
 * ask box pinned to the bottom.
 */
import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { appendMessage, requestReply, useChats, useReplyState } from "../lib/chats";
import type { ApprovedTool } from "../lib/overview";
import { AskBox } from "./HomePage";

export default function ChatPage({ owner, chatId, onAsk, onStartCoaching }: {
  owner: string;
  chatId: string | null;
  onAsk: (text: string) => void;
  onStartCoaching: (tool: ApprovedTool) => void;
}) {
  const { t, m } = useT();
  const chats = useChats(owner);
  const chat = chatId ? chats.find((c) => c.id === chatId) ?? null : null;
  const { busy, failure } = useReplyState(chatId);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [chat?.messages.length, busy]);

  function send(text: string) {
    if (!chat) { onAsk(text); return; }
    appendMessage(owner, chat.id, { role: "user", content: text });
    void requestReply(owner, chat.id);
  }

  if (!chat) {
    return (
      <div className="chat-empty">
        <h1 className="hello"><img src="/socrates-logo.svg" alt="" />{t("thread.emptyTitle")}</h1>
        <p className="sub">{t("thread.emptySub")}</p>
        <AskBox onAsk={send} onStartCoaching={onStartCoaching} autoFocus />
        <div className="sug">
          {m.chat.suggest.map((s) => (
            <button key={s} onClick={() => send(s)}><small>{t("thread.ask")}</small><span>{s}</span></button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="chat-live">
      <div className="thread">
        {chat.messages.map((msg, i) => msg.role === "user" ? (
          <div key={i} className="tmsg u">{msg.content}</div>
        ) : (
          <div key={i} className="tmsg a"><img src="/socrates-logo.svg" alt="" /><div>{msg.content}</div></div>
        ))}
        {busy && <div className="tmsg a pending"><img src="/socrates-logo.svg" alt="" /><div>{t("thread.thinking")}</div></div>}
        {failure && <div className="msg-err">{t("chat.error", { detail: failure })}</div>}
        <div ref={endRef} />
      </div>
      <div className="bottom">
        <AskBox onAsk={send} onStartCoaching={onStartCoaching} autoFocus disabled={busy} />
      </div>
    </div>
  );
}
