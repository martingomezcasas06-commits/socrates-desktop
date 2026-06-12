/**
 * CoachingPage — the core of the desktop app.
 *
 * Two modes:
 *   Advisory  — always running. Captures a screenshot every 5s, sends to
 *               /api/coaching/analyze, displays guidance + stuck detection.
 *               When stuck=true, shows an "offer" button.
 *
 *   Autonomous — triggered when employee accepts Socrates' offer.
 *               Sends screenshot to /api/coaching/autonomous, which uses
 *               Claude computer-use to decide the next action (click/type/scroll).
 *               The Tauri backend executes the action via enigo (Rust).
 *               Loops until Claude signals "task_complete".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

// Detect if running inside Tauri (has native IPC) or plain browser
const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Lazy-load Tauri APIs only when running inside the app
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
async function getTauriWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

type Mode = "idle" | "advisory" | "autonomous";

type AnalysisResult = {
  guidance: string;
  stuck: boolean;
  offer: string | null;       // e.g. "Want me to navigate to Memory settings?"
};

type AutonomousResult = {
  action:           string;       // "click" | "type" | "scroll" | "done"
  x:                number | null;
  y:                number | null;
  value:            string;
  scroll_direction: string;
  action_taken:     string;       // human-readable description
  task_complete:    boolean;
  summary:          string | null;
};

const API_URL  = import.meta.env.VITE_API_URL as string;
const INTERVAL = 5000; // ms between screenshots in advisory mode

export default function CoachingPage({
  session,
  initialTool,
}: {
  session: Session;
  initialTool: string;
}) {
  const [tool, setTool] = useState(initialTool || "");
  const [mode, setMode] = useState<Mode>("idle");
  const [guidance, setGuidance] = useState("");
  const [offer, setOffer] = useState<string | null>(null);
  const [autonomousLog, setAutonomousLog] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autonomousRef = useRef(false);
  const analyzingRef = useRef(false);

  // Inline Q&A while coaching — ask about whatever is on screen right now
  const [qa, setQa] = useState<{ q: string; a: string | null }[]>([]);
  const [askInput, setAskInput] = useState("");
  const [asking, setAsking] = useState(false);
  const guidanceScrollRef = useRef<HTMLDivElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── Screen capture ────────────────────────────────────────────────────────
  async function captureScreen(): Promise<string> {
    if (IS_TAURI) {
      return tauriInvoke<string>("capture_screen");
    }
    // Browser fallback: draw current video frame to canvas
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return "";
    const ctx = canvas.getContext("2d")!;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  }

  // ── Advisory mode loop ────────────────────────────────────────────────────
  const analyzeScreen = useCallback(async () => {
    if (mode === "autonomous") return;     // don't interrupt
    if (analyzingRef.current) return;       // skip if a call is already in flight
    analyzingRef.current = true;
    try {
      const screenshot = await captureScreen();
      if (!screenshot || screenshot.length < 100) {
        setError(
          IS_TAURI
            ? "Couldn't capture your screen. Enable Screen Recording for Socrates in System Settings → Privacy & Security, then restart the app."
            : "Couldn't capture your screen. Try restarting the session."
        );
        return;
      }
      setError("");
      setGuidance((g) => g || "Looking at your screen…");

      const res = await fetch(`${API_URL}/api/coaching/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ screenshot, tool }),
      });
      if (!res.ok) {
        setError(`Socrates couldn't analyze the screen (HTTP ${res.status}).`);
        return;
      }
      const data: AnalysisResult = await res.json();
      setGuidance(data.guidance);
      if (data.stuck && data.offer) setOffer(data.offer);
    } catch (e) {
      setError(`Connection problem: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      analyzingRef.current = false;
    }
  }, [mode, tool, session.access_token]);

  async function startAdvisory() {
    if (!tool.trim()) { setError("Please enter the tool name first."); return; }
    setError("");

    // Browser mode: request screen share via getDisplayMedia
    if (!IS_TAURI) {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setError("Screen sharing not supported. Use Chrome or Edge.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        stream.getVideoTracks()[0].addEventListener("ended", () => stopSession());
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") return; // cancelled
        setError("Could not share screen. On macOS, enable Screen Recording for your browser in System Settings.");
        return;
      }
    }

    setMode("advisory");
    setGuidance("Starting up — I'll have a look at your screen in a moment…");
    setOffer(null);
    setSummary(null);
    setAutonomousLog([]);
  }

  async function stopSession() {
    autonomousRef.current = false;
    if (intervalRef.current) clearInterval(intervalRef.current);
    // Stop browser stream if any
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    // Restore Tauri window if applicable
    if (IS_TAURI) {
      const win = await getTauriWindow();
      await win.show();
      await win.setAlwaysOnTop(true);
      await win.setFocus();
    }
    setMode("idle");
    setOffer(null);
    setSummary(null);
    setGuidance("");
  }

  // Run advisory loop while in advisory mode
  useEffect(() => {
    if (mode === "advisory") {
      analyzeScreen(); // immediate first scan
      intervalRef.current = setInterval(analyzeScreen, INTERVAL);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [mode, analyzeScreen]);

  // ── Autonomous mode ───────────────────────────────────────────────────────
  async function acceptOffer() {
    setOffer(null);
    setMode("autonomous");
    autonomousRef.current = true;
    setAutonomousLog([]);
    setSummary(null);

    if (IS_TAURI) {
      // Hide Socrates so it doesn't block clicks on other apps
      const win = await getTauriWindow();
      await win.setAlwaysOnTop(false);
      await win.hide();
    }

    await runAutonomousLoop();

    if (IS_TAURI) {
      const win = await getTauriWindow();
      await win.show();
      await win.setAlwaysOnTop(true);
      await win.setFocus();
    }
  }

  async function runAutonomousLoop() {
    while (autonomousRef.current) {
      try {
        const screenshot = await captureScreen();
        const res = await fetch(`${API_URL}/api/coaching/autonomous`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ screenshot, tool, log: autonomousLog }),
        });

        if (!res.ok) { autonomousRef.current = false; break; }
        const data: AutonomousResult = await res.json();

        setAutonomousLog((prev) => [...prev, data.action_taken]);

        if (data.task_complete) {
          autonomousRef.current = false;
          setSummary(data.summary ?? "Done! Handing control back to you.");
          setMode("advisory");
          setGuidance(data.summary ?? "");
          break;
        }

        // Execute the action on the actual screen via Rust/enigo (Tauri only)
        if (data.action !== "done" && IS_TAURI) {
          try {
            await tauriInvoke("execute_action", {
              action:          data.action,
              x:               data.x,
              y:               data.y,
              text:            data.value || null,
              scrollDirection: data.scroll_direction || "down",
            });
          } catch (execErr) {
            console.error("execute_action error:", execErr);
          }
        }

        // Pause so the UI can settle before the next screenshot
        await new Promise((r) => setTimeout(r, 1200));
      } catch (e) {
        console.error("autonomous error", e);
        autonomousRef.current = false;
        setMode("advisory");
        break;
      }
    }
  }

  function declineOffer() {
    setOffer(null);
  }

  // ── Inline question while coaching ────────────────────────────────────────
  async function askQuestion(e: React.FormEvent) {
    e.preventDefault();
    const q = askInput.trim();
    if (!q || asking) return;
    setAskInput("");
    setAsking(true);
    setQa((prev) => [...prev, { q, a: null }]);
    try {
      const screenshot = await captureScreen();
      const res = await fetch(`${API_URL}/api/coaching/analyze`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ screenshot, tool, question: q }),
      });
      const data: AnalysisResult = await res.json();
      setQa((prev) => prev.map((item, i) => (i === prev.length - 1 ? { ...item, a: data.guidance } : item)));
    } catch {
      setQa((prev) => prev.map((item, i) => (i === prev.length - 1 ? { ...item, a: "Sorry — couldn't reach Socrates. Try again." } : item)));
    }
    setAsking(false);
  }

  // Keep the feed scrolled to the latest answer
  useEffect(() => {
    const el = guidanceScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [qa]);

  const [tab, setTab] = useState<"coaching" | "chat">("coaching");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e293b", flexShrink: 0, alignItems: "center" }}>
        {(["coaching", "chat"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600,
            background: "transparent", border: "none", cursor: "pointer",
            color: tab === t ? "#818cf8" : "#475569",
            borderBottom: tab === t ? "2px solid #6366f1" : "2px solid transparent",
            transition: "color 120ms",
            textTransform: "capitalize",
          }}>{t === "coaching" ? "🖥 Coaching" : "◎ Chat"}</button>
        ))}
        <button
          title="Pop out Socrates into a floating window"
          onClick={() => {
            const w = window.open(
              window.location.href,
              "socrates-companion",
              "width=320,height=600,resizable=yes,scrollbars=no"
            );
            if (w) w.focus();
          }}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "#475569", fontSize: 14, padding: "0 12px",
            flexShrink: 0,
          }}
          title="Pop out"
        >⊞</button>
      </div>

      {tab === "chat" && <CoachingChat session={session} tool={tool} />}
      {tab === "coaching" && <div style={styles.wrap}>
      {/* Hidden video/canvas for browser screen capture */}
      <video ref={videoRef} muted playsInline style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {/* Tool selector */}
      <div style={styles.header}>
        <input
          value={tool}
          onChange={(e) => setTool(e.target.value)}
          placeholder="Which tool? (e.g. ChatGPT, Claude…)"
          style={styles.toolInput}
          disabled={mode !== "idle"}
        />
        {mode === "idle" ? (
          <button onClick={startAdvisory} style={styles.startBtn}>Start session</button>
        ) : (
          <button onClick={stopSession} style={styles.stopBtn}>Stop</button>
        )}
      </div>
      {error && <div style={styles.error}>{error}</div>}

      {/* Idle state */}
      {mode === "idle" && (
        <div style={styles.idle}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>◎</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Ready to coach</div>
          <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6, maxWidth: 260, textAlign: "center" }}>
            Enter the tool name and hit Start. I'll watch your screen and guide you step by step. If you get stuck, I'll offer to help automatically.
          </div>
        </div>
      )}

      {/* Advisory guidance + inline Q&A */}
      {mode === "advisory" && (
        <>
          <div ref={guidanceScrollRef} style={styles.guidance}>
            <div style={styles.guidanceLabel}>◎ Socrates is watching</div>
            <p style={styles.guidanceText}>{guidance || "Analysing your screen…"}</p>

            {qa.length > 0 && (
              <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                {qa.map((item, i) => (
                  <div key={i}>
                    <div style={styles.qBubble}>{item.q}</div>
                    <div style={styles.aText}>
                      {item.a ?? <span style={{ opacity: 0.5, fontStyle: "italic" }}>looking at your screen…</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ask box — always reachable while the floating window sits over your work */}
          <form onSubmit={askQuestion} style={styles.askRow}>
            <input
              value={askInput}
              onChange={(e) => setAskInput(e.target.value)}
              placeholder="Ask about what's on your screen…"
              style={styles.askInput}
            />
            <button
              type="submit"
              disabled={!askInput.trim() || asking}
              style={{ ...styles.askBtn, opacity: !askInput.trim() || asking ? 0.5 : 1 }}
            >↑</button>
          </form>
        </>
      )}

      {/* Autonomous mode overlay */}
      {mode === "autonomous" && (
        <div style={styles.autonomousWrap}>
          <div style={styles.autonomousHeader}>
            <div style={styles.pulsingDot} />
            <span style={{ fontWeight: 700, color: "#818cf8" }}>Socrates is in control</span>
            <button onClick={stopSession} style={styles.stopSmallBtn}>Stop</button>
          </div>
          <div style={styles.actionLog}>
            {autonomousLog.map((a, i) => (
              <div key={i} style={styles.actionItem}>✓ {a}</div>
            ))}
            <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>Working…</div>
          </div>
        </div>
      )}

      {/* Summary after autonomous task */}
      {summary && mode === "advisory" && (
        <div style={styles.summaryBox}>
          <div style={{ fontSize: 16, marginBottom: 6 }}>✅</div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Done</div>
          <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{summary}</div>
        </div>
      )}

      {/* Offer prompt — proactive offer from Socrates */}
      {offer && (
        <div style={styles.offerBox}>
          <div style={styles.offerText}>💡 {offer}</div>
          <div style={styles.offerActions}>
            <button onClick={acceptOffer} style={styles.offerYes}>Yes, do it</button>
            <button onClick={declineOffer} style={styles.offerNo}>No thanks</button>
          </div>
        </div>
      )}
      </div>}{/* end coaching tab */}
    </div>
  );
}

// ── Embedded chat panel ───────────────────────────────────────────────────────
type ChatMsg = { role: "user" | "assistant"; content: string };

function CoachingChat({ session, tool }: { session: Session; tool: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: "I'm here while you work. Ask me anything about what you're doing." },
  ]);
  const [input, setInput]   = useState("");
  const [busy, setBusy]     = useState(false);
  const listRef             = useRef<HTMLDivElement>(null);
  const textareaRef         = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  async function send() {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    setBusy(true);
    const next: ChatMsg[] = [...messages, { role: "user", content: t }];
    setMessages(next);
    try {
      const res = await fetch(`${API_URL}/api/chat/employee-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ messages: next }),
      });
      const reply = await res.text();
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Something went wrong. Try again." }]);
    }
    setBusy(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div style={{
      width: 260, borderLeft: "1px solid #1e293b",
      display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0,
    }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid #1e293b", fontSize: 10, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 }}>
        Ask Socrates{tool ? ` about ${tool}` : ""}
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "12px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              background: m.role === "user" ? "#312e81" : "#1e293b",
              color: m.role === "user" ? "#e0e7ff" : "#cbd5e1",
              borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
              padding: "8px 10px",
              fontSize: 12,
              lineHeight: 1.6,
              maxWidth: "90%",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ fontSize: 11, color: "#475569", fontStyle: "italic", paddingLeft: 2 }}>thinking…</div>
        )}
      </div>

      <div style={{ padding: "8px 10px", borderTop: "1px solid #1e293b", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px" }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything…"
            rows={1}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f1f5f9", fontSize: 12, resize: "none", fontFamily: "inherit", lineHeight: 1.5, maxHeight: 120, overflowY: "auto" }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || busy}
            style={{ background: input.trim() && !busy ? "#6366f1" : "#1e3a5f", border: "none", borderRadius: 6, width: 28, height: 28, color: "#fff", fontSize: 14, cursor: input.trim() && !busy ? "pointer" : "not-allowed", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >↑</button>
        </div>
        <div style={{ fontSize: 10, color: "#334155", textAlign: "center", marginTop: 4 }}>Enter to send</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" },
  header: { display: "flex", gap: 8, padding: "12px 14px", borderBottom: "1px solid #1e293b", flexShrink: 0 },
  toolInput: {
    flex: 1,
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 7,
    padding: "8px 11px",
    color: "#f1f5f9",
    fontSize: 13,
    outline: "none",
  },
  startBtn: {
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  stopBtn: {
    background: "#7f1d1d",
    color: "#fca5a5",
    border: "1px solid #991b1b",
    borderRadius: 7,
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  error: { fontSize: 12, color: "#f87171", padding: "4px 14px" },
  idle: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "#94a3b8",
    fontSize: 13,
    padding: 24,
  },
  guidance: { flex: 1, overflowY: "auto", padding: 16 },
  guidanceLabel: { fontSize: 10, fontWeight: 700, color: "#6366f1", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  guidanceText: { fontSize: 13, color: "#cbd5e1", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" },
  qBubble: {
    fontSize: 12,
    color: "#e0e7ff",
    background: "#312e81",
    borderRadius: "10px 10px 2px 10px",
    padding: "7px 11px",
    marginLeft: "auto",
    maxWidth: "85%",
    width: "fit-content",
    lineHeight: 1.5,
  },
  aText: { fontSize: 12, color: "#cbd5e1", lineHeight: 1.7, marginTop: 6, whiteSpace: "pre-wrap" },
  askRow: {
    display: "flex",
    gap: 6,
    padding: "8px 12px",
    borderTop: "1px solid #1e293b",
    flexShrink: 0,
  },
  askInput: {
    flex: 1,
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 7,
    padding: "7px 10px",
    color: "#f1f5f9",
    fontSize: 12,
    outline: "none",
  },
  askBtn: {
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    width: 30,
    height: 30,
    fontSize: 14,
    cursor: "pointer",
    flexShrink: 0,
  },
  autonomousWrap: { flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  autonomousHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#1e1b4b",
    border: "1px solid #3730a3",
    borderRadius: 10,
    padding: "10px 14px",
  },
  pulsingDot: {
    width: 8, height: 8, borderRadius: "50%", background: "#818cf8",
    animation: "pulse 1.5s infinite",
    flexShrink: 0,
  },
  stopSmallBtn: {
    marginLeft: "auto",
    background: "transparent",
    color: "#94a3b8",
    border: "1px solid #334155",
    borderRadius: 6,
    padding: "3px 8px",
    fontSize: 11,
    cursor: "pointer",
  },
  actionLog: {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 8,
    padding: 12,
    fontSize: 12,
    color: "#94a3b8",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflowY: "auto",
    flex: 1,
  },
  actionItem: { color: "#86efac", fontSize: 12, lineHeight: 1.4 },
  summaryBox: {
    margin: 14,
    background: "#14532d33",
    border: "1px solid #166534",
    borderRadius: 10,
    padding: 14,
    textAlign: "center",
  },
  offerBox: {
    position: "absolute",
    bottom: 62,
    left: 14,
    right: 14,
    background: "#1e293b",
    border: "1px solid #6366f1",
    borderRadius: 12,
    padding: 14,
    boxShadow: "0 8px 32px rgba(99,102,241,0.3)",
  },
  offerText: { fontSize: 13, color: "#e0e7ff", lineHeight: 1.6, marginBottom: 12 },
  offerActions: { display: "flex", gap: 8 },
  offerYes: {
    flex: 1,
    background: "#6366f1",
    color: "#fff",
    border: "none",
    borderRadius: 7,
    padding: "9px",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  offerNo: {
    flex: 1,
    background: "transparent",
    color: "#64748b",
    border: "1px solid #334155",
    borderRadius: 7,
    padding: "9px",
    fontSize: 13,
    cursor: "pointer",
  },
};
