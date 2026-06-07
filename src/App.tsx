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
import "./App.css";

export type Page = "stack" | "chat" | "coaching";

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
      <div style={styles.center}>
        <div style={styles.avatar}>S</div>
      </div>
    );
  }

  if (!session) return <AuthPage deepLinkError={deepLinkError} deepLinkRaw={deepLinkRaw} />;

  // Password-reset deep link was clicked — show the set-new-password screen
  if (recovering) return <ResetPasswordPage />;

  return (
    <div style={styles.shell}>
      {/* Nav */}
      <nav style={styles.nav}>
        <div style={styles.brand}>
          <div style={styles.avatar}>S</div>
          <span style={styles.brandName}>Socrates</span>
        </div>
        <div style={styles.navLinks}>
          <NavBtn label="Stack"    active={page === "stack"}    onClick={() => setPage("stack")} />
          <NavBtn label="Chat"     active={page === "chat"}     onClick={() => setPage("chat")} />
          <NavBtn label="Coaching" active={page === "coaching"} onClick={() => setPage("coaching")} />
          <button
            onClick={() => supabase.auth.signOut()}
            style={styles.signOutBtn}
            title="Sign out"
          >
            ↩
          </button>
        </div>
      </nav>

      {/* Page */}
      <main style={styles.main}>
        {page === "stack"    && <StackPage onStartCoaching={startCoaching} />}
        {page === "chat"     && <ChatPage session={session} />}
        {page === "coaching" && <CoachingPage session={session} initialTool={coachingTool} />}
      </main>
    </div>
  );
}

function NavBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...styles.navBtn,
        background: active ? "#6366f1" : "transparent",
        color: active ? "#fff" : "#94a3b8",
      }}
    >
      {label}
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#0f172a",
    color: "#f1f5f9",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    borderBottom: "1px solid #1e293b",
    flexShrink: 0,
  },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  brandName: { fontSize: 14, fontWeight: 700, color: "#f1f5f9" },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
  },
  navLinks: { display: "flex", gap: 4 },
  signOutBtn: {
    border: "none",
    borderRadius: 6,
    padding: "5px 8px",
    fontSize: 14,
    cursor: "pointer",
    background: "transparent",
    color: "#475569",
    marginLeft: 4,
  },
  navBtn: {
    border: "none",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    transition: "background 120ms",
  },
  main: { flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" },
  center: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f172a",
  },
};
