import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { supabase } from "./lib/supabase";
import AuthPage from "./pages/AuthPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import StackPage from "./pages/StackPage";
import ChatPage from "./pages/ChatPage";
import CoachingPage from "./pages/CoachingPage";
import Icon from "./Icon";

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

export default function App() {
  const [session, setSession]         = useState<Session | null>(null);
  const [loading, setLoading]         = useState(true);
  const [recovering, setRecovering]   = useState(false); // PASSWORD_RECOVERY flow
  const [page, setPage]               = useState<Page>("stack");
  const [coachingTool, setCoachingTool] = useState<string>("");
  const [deepLinkError, setDeepLinkError] = useState<string>("");
  const [deepLinkRaw, setDeepLinkRaw]     = useState<string>("");

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

    // Handle deep link: socrates://auth/callback?code=xxx
    onOpenUrl((urls) => {
      const url = urls[0];
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

        supabase.auth.exchangeCodeForSession(code)
          .then(({ error }) => {
            if (error) setDeepLinkError(`Exchange failed: ${error.message}`);
          })
          .catch((e) => setDeepLinkError(`Exchange threw: ${String(e)}`));

      } catch (e) {
        setDeepLinkError(`Parse error: ${String(e)} — raw URL: ${url}`);
      }
    }).catch((e) => setDeepLinkError(`onOpenUrl setup failed: ${String(e)}`));

    return () => subscription.unsubscribe();
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

function RailLink({ id, label, icon, page, onNav, pip }: {
  id: Page; label: string; icon: string; page: Page; onNav: (p: Page) => void; pip?: boolean;
}) {
  return (
    <button className={`rail-link${page === id ? " active" : ""}`} onClick={() => onNav(id)}>
      <Icon name={icon} /><span>{label}</span>{pip && <span className="pip" />}
    </button>
  );
}
