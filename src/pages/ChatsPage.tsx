/** Chats: every conversation on this computer, grouped by when it started, with live search. */
import { useState } from "react";
import Icon from "../Icon";
import { useT } from "../i18n";
import { groupOf, useChats, type ChatGroup, type Conversation } from "../lib/chats";

const ORDER: ChatGroup[] = ["today", "yesterday", "thisWeek", "lastWeek", "earlier"];

export default function ChatsPage({ owner, onOpenChat, onNewChat }: {
  owner: string;
  onOpenChat: (id: string) => void;
  onNewChat: () => void;
}) {
  const { t } = useT();
  const chats = useChats(owner);
  const [q, setQ] = useState("");

  const needle = q.trim().toLowerCase();
  const firstQuestion = (c: Conversation) => c.messages.find((m) => m.role === "user")?.content ?? "";
  const matches = chats
    .filter((c) => !needle || c.title.toLowerCase().includes(needle) || firstQuestion(c).toLowerCase().includes(needle))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const groups = ORDER
    .map((g) => ({ g, items: matches.filter((c) => groupOf(c.created_at) === g) }))
    .filter((x) => x.items.length);

  return (
    <div className="pg">
      <div className="pg-head">
        <div><span className="ey">{t("chats.eyebrow")}</span><h1 className="t">{t("chats.title")}</h1></div>
        <button className="nbtn gh" onClick={onNewChat}>{t("nav.newConversation")}</button>
      </div>
      <label className="srch">
        <Icon name="lookup" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("chats.search")} />
      </label>
      {!chats.length ? (
        <p className="sub" style={{ marginTop: 30 }}>{t("chats.empty")}</p>
      ) : !groups.length ? (
        <p className="sub" style={{ marginTop: 30 }}>{t("chats.noMatch")}</p>
      ) : groups.map(({ g, items }) => (
        <div key={g}>
          <div className="lbl">{t(`chats.groups.${g}`)}</div>
          {items.map((c) => (
            <button key={c.id} className="crow" onClick={() => onOpenChat(c.id)}>
              <div><b>{c.title}</b><small>{firstQuestion(c)}</small></div>
              <span>{t("chats.open")}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
