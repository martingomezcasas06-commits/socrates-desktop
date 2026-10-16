/**
 * The Night sidebar. Collapsed it is a 60px icon rail; hovering opens it to
 * 232px as an overlay (the page doesn't reflow) after 120ms, and leaving
 * closes it after 200ms. The pin keeps it open, and then it takes layout width.
 * Admin pages live on the website, so their items open the browser.
 */
import { useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import { useT } from "../i18n";
import { useOverview, initialsOf } from "../lib/overview";
import { useChats } from "../lib/chats";
import type { Page } from "../App";
import { openExternal } from "../lib/openExternal";

const API_URL = import.meta.env.VITE_API_URL as string;
const PIN_KEY = "socrates.sidebar.pinned";

function readPinned(): boolean {
  try { return localStorage.getItem(PIN_KEY) === "1"; } catch { return false; }
}
function savePinned(v: boolean) {
  try { localStorage.setItem(PIN_KEY, v ? "1" : "0"); } catch { /* not kept */ }
}

export default function Sidebar({ page, chatId, owner, fallbackName, onNav, onOpenChat, onNewChat }: {
  page: Page;
  chatId: string | null;
  owner: string;
  fallbackName: string;
  onNav: (p: Page) => void;
  onOpenChat: (id: string) => void;
  onNewChat: () => void;
}) {
  const { t } = useT();
  const { data } = useOverview();
  const chats = useChats(owner);
  const [pinned, setPinned] = useState(readPinned);
  const [open, setOpen] = useState(pinned);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function hover(entering: boolean) {
    if (pinned) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(entering), entering ? 120 : 200);
  }
  function togglePin() {
    const next = !pinned;
    setPinned(next);
    setOpen(next);
    savePinned(next);
  }

  const role = data?.user.role ?? "employee";
  const name = data?.user.name || fallbackName;
  const waiting = data?.waiting.length ?? 0;
  const mini = !open;

  const item = (id: Page, label: string, icon: string, count?: number) => {
    const on = page === id || (id === "chats" && page === "chat" && !chatId);
    return (
      <button key={id} className={`ni${on ? " on" : ""}`} title={label} onClick={() => onNav(id)}>
        <Icon name={icon} />
        <span className="tx">{label}</span>
        {count ? <span className="ct">{count}</span> : null}
      </button>
    );
  };
  const web = (path: string, label: string, icon: string, count?: number) => (
    <button key={path} className="ni" title={t("nav.opensInBrowser", { label })} onClick={() => void openExternal(`${API_URL}${path}`)}>
      <Icon name={icon} />
      <span className="tx">{label}</span>
      {count ? <span className="ct">{count}</span> : null}
    </button>
  );

  return (
    <div className={`sidewrap${pinned ? " pinned" : ""}`}>
      <aside className={`side${mini ? " mini" : ""}`} onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
        <div className="brand">
          <img src="/socrates-logo.svg" alt="" />
          <span className="tx">Socrates</span>
          <button className="col" title={pinned ? t("nav.unpin") : t("nav.pin")} onClick={togglePin}>
            <Icon name="sidebar" />
          </button>
        </div>

        <button className="new" title={t("nav.newConversation")} onClick={onNewChat}>
          <Icon name="plus" />
          <span className="tx">{t("nav.newConversation")}</span>
        </button>

        <div className="navs">
          {item("home", t("nav.home"), "home")}
          {item("coaching", t("nav.coaching"), "video")}
          {item("chats", t("nav.chats"), "bubble")}
          {item("stack", t("nav.stack"), "box")}
          {item("history", t("nav.history"), "history")}

          {role !== "employee" && (
            <>
              <div className="sec">{t("nav.admin")}</div>
              {web(role === "admin" ? "/admin/approvals" : "/chief/approvals", t("nav.approvals"), "approve", waiting)}
              {role === "admin" && web("/admin/tools", t("nav.catalog"), "grid")}
              {role === "admin" && web("/admin/audit", t("nav.audit"), "audit")}
            </>
          )}

          {item("settings", t("nav.settings"), "gear")}

          {chats.length > 0 && (
            <>
              <div className="sec rcs">{t("nav.recents")}</div>
              {chats.slice(0, 5).map((c) => (
                <button key={c.id} className={`ni rc${page === "chat" && chatId === c.id ? " on" : ""}`} title={c.title} onClick={() => onOpenChat(c.id)}>
                  <span className="tx">{c.title}</span>
                </button>
              ))}
              {chats.length > 5 && (
                <button className="ni rc more" onClick={() => onNav("chats")}><span className="tx">{t("nav.allChats")}</span></button>
              )}
            </>
          )}
        </div>

        <button className="me" title={name} onClick={() => onNav("settings")}>
          <span className="av">{initialsOf(name)}</span>
          <span className="tx">
            <span className="nm">{name}</span>
            <small>{t(`nav.roles.${role}`)}</small>
          </span>
        </button>
      </aside>
    </div>
  );
}
