import { useEffect, useState, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { supabase } from "./lib/supabase";
import AuthPage from "./pages/AuthPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import StackPage from "./pages/StackPage";
import ChatPage from "./pages/ChatPage";
import CoachingPage from "./pages/CoachingPage";
import Icon from "./Icon";
import { checkAndInstall, restartIntoUpdate, type UpdateState } from "./lib/updates";

export type Page = "stack" | "chat" | "coaching";

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
const handledAuthCodes = new Set<string>();

export default function App() {
  const [session, setSession]         = useState<Session | null>(null);
  const [loading, setLoading]         = useState(true);
  const [recovering, setRecovering]   = useState(false); // PASSWORD_RECOVERY flow
  const [page, setPage]               = useState<Page>("stack");
  const [coachingTool, setCoachingTool] = useState<string>("");
  const [deepLinkError, setDeepLinkError] = useState<string>("");
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
      if (!url) { setDeepLinkError("Deep link fired but URL was empty"); return; }
      try {
        const parsed = new URL(url.replace(/^socrates:\/\//, "https://socrates.app/"));
        const code = parsed.searchParams.get("code");
        const errorParam = parsed.searchParams.get("error");
        const errorDesc = parsed.searchParams.get("error_description");

        if (errorParam) {
          setDeepLinkError(`OAuth error: ${errorDesc || errorParam}`);
          return;
        }

        if (!code) {
          // Maybe tokens are in the hash (implicit flow fallback)
          setDeepLinkError(`No code in URL: ${url}`);
          return;
        }

        if (handledAuthCodes.has(code)) return;
        handledAuthCodes.add(code);

        supabase.auth.exchangeCodeForSession(code)
          .then(({ error }) => {
            if (error) setDeepLinkError(`Exchange failed: ${error.message}`);
          })
          .catch((e) => setDeepLinkError(`Exchange threw: ${String(e)}`));

      } catch (e) {
        setDeepLinkError(`Parse error: ${String(e)} — raw URL: ${url}`);
      }
    };

    getCurrent()
      .then((urls) => { if (urls?.length) handleAuthUrl(urls[0]); })
      .catch((e) => setDeepLinkError(`getCurrent failed: ${String(e)}`));

    const unlisten = onOpenUrl((urls) => handleAuthUrl(urls[0]))
      .catch((e) => { setDeepLinkError(`onOpenUrl setup failed: ${String(e)}`); return undefined; });

    return () => {
      subscription.unsubscribe();
      void unlisten.then((stop) => stop?.());
    };
  }, []);

  function startCoaching(toolName: string) {
    setCoachingTool(toolName);
    setPage("coaching");
  }

  if (loading) {
    return (
      <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "var(--bg)" }}>
        <span className="brand-mark" style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  if (!session) return <AuthPage deepLinkError={deepLinkError} deepLinkRaw={deepLinkRaw} />;

  // Password-reset deep link was clicked — show the set-new-password screen
  if (recovering) return <ResetPasswordPage />;

  const email = session.user.email ?? "";
  const name = (session.user.user_metadata?.name as string) || displayName(email);

  return (
    <div className="app-body">
      <UpdateBar state={update} />
      <aside className="rail">
        <div className="rail-brand"><span className="brand-mark" /><span className="nm">Socrates</span></div>
        <div className="rail-section"><span>Workspace</span></div>
        <nav className="rail-nav">
          <RailLink id="stack" label="Stack" icon="stack" page={page} onNav={setPage} />
          <RailLink id="chat" label="Chat" icon="chat" page={page} onNav={setPage} />
          <RailLink id="coaching" label="Coaching" icon="coach" page={page} onNav={setPage} pip={page !== "coaching"} />
        </nav>
        <div className="rail-foot">
          <div className="rail-user">
            <div className="avatar">{initialsOf(name || email)}</div>
            <div className="meta">
              <div className="nm">{name}</div>
              <div className="rl">{email}</div>
            </div>
            <button className="out" onClick={() => supabase.auth.signOut()} title="Sign out"><Icon name="logout" /></button>
          </div>
        </div>
      </aside>

      <div className="content">
        {page === "stack" && <StackPage session={session} onStartCoaching={startCoaching} />}
        {page === "chat" && <ChatPage session={session} />}
        {page === "coaching" && <CoachingPage session={session} initialTool={coachingTool} />}
      </div>
    </div>
  );
}

/** Slim strip shown only while an update is downloading or waiting to be applied.
 *  Inline styles on purpose: this must survive the app restyle untouched. */
function UpdateBar({ state }: { state: UpdateState }) {
  if (state.status === "idle" || state.status === "error") return null;
  const bar: CSSProperties = {
    position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
    display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
    padding: "7px 14px", fontSize: 13, lineHeight: 1.3,
    background: "#15637F", color: "#fff",
  };
  if (state.status === "downloading") {
    return <div style={bar}>Downloading update {state.version} — {state.percent}%</div>;
  }
  return (
    <div style={bar}>
      <span>Update {state.version} is ready.</span>
      <button
        onClick={() => { void restartIntoUpdate(); }}
        style={{
          background: "#fff", color: "#15637F", border: 0, borderRadius: 4,
          padding: "3px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}
      >
        Restart now
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
