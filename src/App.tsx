import { useEffect, useState, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { parseAuthLink, createCodeGate } from "./lib/authLink";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { supabase } from "./lib/supabase";
import AuthPage from "./pages/AuthPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import StackPage from "./pages/StackPage";
import ChatPage from "./pages/ChatPage";
import ChatsPage from "./pages/ChatsPage";
import CoachingPage from "./pages/CoachingPage";
import HomePage from "./pages/HomePage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import Sidebar from "./components/Sidebar";
import { checkAndInstall, restartIntoUpdate, type UpdateState } from "./lib/updates";
import { LocaleProvider, useT } from "./i18n";
import type { MessageKey } from "./i18n/en";
import OverviewProvider from "./components/OverviewProvider";
import type { ApprovedTool } from "./lib/overview";
import { createChat, requestReply } from "./lib/chats";

export type Page = "home" | "coaching" | "chats" | "chat" | "stack" | "history" | "settings";

/** A deep-link failure, kept untranslated so a language switch re-renders it. */
type LinkError = { key: MessageKey; vars?: Record<string, string> } | null;

function displayName(s: string): string {
  if (!s.includes("@")) return s;
  return s.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Module-level, not state: it must survive React re-running the effect (StrictMode
// in dev does exactly that), or the same code gets exchanged twice and the second
// attempt reports a spurious "Exchange failed".
const firstTimeForCode = createCodeGate();

export default function App() {
  const [session, setSession]         = useState<Session | null>(null);
  const [loading, setLoading]         = useState(true);
  const [recovering, setRecovering]   = useState(false); // PASSWORD_RECOVERY flow
  const [deepLinkError, setDeepLinkError] = useState<LinkError>(null);
  const [deepLinkRaw, setDeepLinkRaw]     = useState<string>("");
  const [update, setUpdate]               = useState<UpdateState>({ status: "idle" });

  // Check for a new build once per launch. Runs independently of auth so a tester on
  // Windows picks up fixes without reinstalling the app by hand.
  useEffect(() => { void checkAndInstall(setUpdate); }, []);

  useEffect(() => {
    // Load existing session on mount
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Keep session in sync; detect password-recovery flow
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") {
        setRecovering(true);
      } else if (event === "USER_UPDATED") {
        setRecovering(false);
      } else if (event === "SIGNED_IN") {
        // Bring the app forward after a browser sign-in. It is an ordinary window
        // now: only the coaching call strip floats above other apps.
        if ("__TAURI_INTERNALS__" in window) getCurrentWindow().setFocus().catch(console.error);
      }
    });

    // Sign-in links arrive as socrates://auth/callback?code=… by two routes:
    //  - onOpenUrl: the app was already running. Always the case on macOS; on
    //    Windows only because the single-instance plugin forwards the second
    //    process the OS starts for the link.
    //  - getCurrent: the link itself launched the app from closed.
    // Windows used to have neither, which is why sign-in by link never completed
    // there. Both routes can report the same link, and a PKCE code can only be
    // exchanged once, so each code is handled at most once.
    const handleAuthUrl = (url: string | undefined) => {
      setDeepLinkRaw(url ?? "(empty)");   // show immediately — synchronous
      const link = parseAuthLink(url);
      switch (link.kind) {
        case "empty": setDeepLinkError({ key: "deepLink.empty" }); return;
        case "error": setDeepLinkError({ key: "deepLink.oauthError", vars: { message: link.message } }); return;
        case "no-code": setDeepLinkError({ key: "deepLink.noCode", vars: { url: link.url } }); return;
        case "unparseable": setDeepLinkError({ key: "deepLink.parseError", vars: { reason: link.reason, url: link.url } }); return;
        case "code":
          if (!firstTimeForCode(link.code)) return;
          supabase.auth.exchangeCodeForSession(link.code)
            .then(({ error }) => {
              if (error) setDeepLinkError({ key: "deepLink.exchangeFailed", vars: { message: error.message } });
            })
            .catch((e) => setDeepLinkError({ key: "deepLink.exchangeThrew", vars: { message: String(e) } }));
      }
    };

    getCurrent()
      .then((urls) => { if (urls?.length) handleAuthUrl(urls[0]); })
      .catch((e) => setDeepLinkError({ key: "deepLink.getCurrentFailed", vars: { message: String(e) } }));

    const unlisten = onOpenUrl((urls) => handleAuthUrl(urls[0]))
      .catch((e) => { setDeepLinkError({ key: "deepLink.onOpenUrlFailed", vars: { message: String(e) } }); return undefined; });

    return () => {
      subscription.unsubscribe();
      void unlisten.then((stop) => stop?.());
    };
  }, []);

  return (
    <LocaleProvider signedIn={!!session}>
      {loading ? (
        <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "var(--bg)" }}>
          <span className="brand-mark" style={{ width: 40, height: 40 }} />
        </div>
      ) : !session ? (
        <SignedOut deepLinkError={deepLinkError} deepLinkRaw={deepLinkRaw} />
      ) : recovering ? (
        // Password-reset deep link was clicked — show the set-new-password screen
        <ResetPasswordPage />
      ) : (
        <OverviewProvider>
          <Shell session={session} update={update} />
        </OverviewProvider>
      )}
    </LocaleProvider>
  );
}

function SignedOut({ deepLinkError, deepLinkRaw }: { deepLinkError: LinkError; deepLinkRaw: string }) {
  const { t } = useT();
  return (
    <AuthPage
      deepLinkError={deepLinkError ? t(deepLinkError.key, deepLinkError.vars) : ""}
      deepLinkRaw={deepLinkRaw}
    />
  );
}

/** Where the app is: the page, the open chat (if any), and the coaching call asked for. */
type Nav = {
  page: Page;
  chatId: string | null;
  /** The tool a coaching session was started for, from Home or the popover. */
  coachTool: ApprovedTool | null;
  coachRequest: number;
};

function Shell({ session, update }: { session: Session; update: UpdateState }) {
  const email = session.user.email ?? "";
  const name = (session.user.user_metadata?.name as string) || displayName(email);
  const owner = session.user.id;
  const [nav, setNav] = useState<Nav>({ page: "home", chatId: null, coachTool: null, coachRequest: 0 });

  const go = (page: Page) => setNav((n) => ({ ...n, page, chatId: page === "chat" ? n.chatId : null }));
  const openChat = (id: string) => setNav((n) => ({ ...n, page: "chat", chatId: id }));
  const newChat = () => setNav((n) => ({ ...n, page: "chat", chatId: null }));
  const ask = (text: string) => {
    const chat = createChat(owner, text);
    setNav((n) => ({ ...n, page: "chat", chatId: chat.id }));
    void requestReply(owner, chat.id);
  };
  const startCoaching = (tool: ApprovedTool) =>
    setNav((n) => ({ ...n, page: "coaching", coachTool: tool, coachRequest: n.coachRequest + 1 }));

  return (
    <div className="night">
      <UpdateBar state={update} />
      <Sidebar
        page={nav.page} chatId={nav.chatId} owner={owner} fallbackName={name}
        onNav={go} onOpenChat={openChat} onNewChat={newChat}
      />
      <main className="nmain">
        {nav.page === "home" && <HomePage fallbackName={name} onAsk={ask} onStartCoaching={startCoaching} />}
        {nav.page === "chat" && (
          <ChatPage
            key={nav.chatId ?? "new"} owner={owner} chatId={nav.chatId}
            onAsk={ask}
            onStartCoaching={startCoaching}
          />
        )}
        {nav.page === "chats" && <ChatsPage owner={owner} onOpenChat={openChat} onNewChat={newChat} />}
        {nav.page === "coaching" && (
          <CoachingPage key={nav.coachRequest} session={session} requested={nav.coachTool} />
        )}
        {nav.page === "stack" && <StackPage />}
        {nav.page === "history" && <HistoryPage />}
        {nav.page === "settings" && <SettingsPage email={email} fallbackName={name} />}
      </main>
    </div>
  );
}

/** Slim strip shown only while an update is downloading or waiting to be applied.
 *  Inline styles on purpose: this must survive the app restyle untouched. */
function UpdateBar({ state }: { state: UpdateState }) {
  const { t } = useT();
  if (state.status === "idle" || state.status === "error") return null;
  const bar: CSSProperties = {
    position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
    padding: "7px 14px", fontSize: 13, lineHeight: 1.3,
    background: "#15637F", color: "#fff",
  };
  if (state.status === "downloading") {
    return <div style={bar}>{t("update.downloading", { version: state.version, percent: state.percent })}</div>;
  }
  return (
    <div style={bar}>
      <span>{t("update.ready", { version: state.version })}</span>
      <button
        onClick={() => { void restartIntoUpdate(); }}
        style={{
          background: "#fff", color: "#15637F", border: 0, borderRadius: 4,
          padding: "3px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}
      >
        {t("update.restart")}
      </button>
    </div>
  );
}
