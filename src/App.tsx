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
import CoachingPage from "./pages/CoachingPage";
import Icon from "./Icon";
import { checkAndInstall, restartIntoUpdate, type UpdateState } from "./lib/updates";
import { LocaleProvider, LanguageSwitch, useT } from "./i18n";
import type { MessageKey } from "./i18n/en";

export type Page = "stack" | "chat" | "coaching";

/** A deep-link failure, kept untranslated so a language switch re-renders it. */
type LinkError = { key: MessageKey; vars?: Record<string, string> } | null;

function initialsOf(s: string): string {
  const base = s.includes("@") ? s.split("@")[0].replace(/[._-]/g, " ") : s;
  const p = base.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "S";
}
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
  const [page, setPage]               = useState<Page>("stack");
  const [coachingTool, setCoachingTool] = useState<string>("");
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
        // Re-pin the window after OAuth sign-in (which temporarily unpins it)
        const win = getCurrentWindow();
        win.setAlwaysOnTop(true).catch(console.error);
        win.setFocus().catch(console.error);
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

  function startCoaching(toolName: string) {
    setCoachingTool(toolName);
    setPage("coaching");
  }

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
        <Shell
          session={session} page={page} setPage={setPage} update={update}
          coachingTool={coachingTool} onStartCoaching={startCoaching}
        />
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

function Shell({ session, page, setPage, update, coachingTool, onStartCoaching }: {
  session: Session; page: Page; setPage: (p: Page) => void; update: UpdateState;
  coachingTool: string; onStartCoaching: (tool: string) => void;
}) {
  const { t } = useT();
  const email = session.user.email ?? "";
  const name = (session.user.user_metadata?.name as string) || displayName(email);

  return (
    <div className="app-body">
      <UpdateBar state={update} />
      <aside className="rail">
        <div className="rail-brand"><span className="brand-mark" /><span className="nm">Socrates</span></div>
        <div className="rail-section"><span>{t("rail.workspace")}</span></div>
        <nav className="rail-nav">
          <RailLink id="stack" label={t("rail.stack")} icon="stack" page={page} onNav={setPage} />
          <RailLink id="chat" label={t("rail.chat")} icon="chat" page={page} onNav={setPage} />
          <RailLink id="coaching" label={t("rail.coaching")} icon="coach" page={page} onNav={setPage} pip={page !== "coaching"} />
        </nav>
        <div className="rail-foot">
          <LanguageSwitch className="rail-lang" />
          <div className="rail-user">
            <div className="avatar">{initialsOf(name || email)}</div>
            <div className="meta">
              <div className="nm">{name}</div>
              <div className="rl">{email}</div>
            </div>
            <button className="out" onClick={() => supabase.auth.signOut()} title={t("rail.signOut")}><Icon name="logout" /></button>
          </div>
        </div>
      </aside>

      <div className="content">
        {page === "stack" && <StackPage session={session} onStartCoaching={onStartCoaching} />}
        {page === "chat" && <ChatPage session={session} />}
        {page === "coaching" && <CoachingPage session={session} initialTool={coachingTool} />}
      </div>
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

function RailLink({ id, label, icon, page, onNav, pip }: {
  id: Page; label: string; icon: string; page: Page; onNav: (p: Page) => void; pip?: boolean;
}) {
  return (
    <button className={`rail-link${page === id ? " active" : ""}`} onClick={() => onNav(id)}>
      <Icon name={icon} /><span>{label}</span>{pip && <span className="pip" />}
    </button>
  );
}
