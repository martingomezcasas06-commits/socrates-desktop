/**
 * CoachingPage — the core of the desktop app. (Design-system reskin; logic unchanged.)
 *
 *   Advisory  — captures a screenshot every 5s → /api/coaching/analyze → guidance
 *               + stuck detection (offer to take over). Inline "ask about your screen" Q&A.
 *   Autonomous — on accepting the offer, loops /api/coaching/autonomous → Claude
 *               decides an action → Tauri/enigo executes it, until task_complete.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Icon from "../Icon";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
async function getTauriWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

const FLOAT_W = 440, FLOAT_H = 680;

/** Shrink the window into a floating, always-on-top coaching companion parked
 *  top-right — so it stays visible and reachable while you work in another app. */
async function enterFloating() {
  try {
    const { getCurrentWindow, currentMonitor } = await import("@tauri-apps/api/window");
    const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(FLOAT_W, FLOAT_H));
    const mon = await currentMonitor();
    if (mon) {
      const scale = mon.scaleFactor || 1;
      const monW = mon.size.width / scale;
      await win.setPosition(new LogicalPosition(Math.max(12, monW - FLOAT_W - 24), 56));
    }
    // Turn the window into a non-activating panel that floats over everything — including
    // another app's native fullscreen. (Rust orders it front without activating our app.)
    try { await tauriInvoke("set_fullscreen_overlay", { enable: true }); } catch { /* older build */ }
  } catch (e) { console.error("enterFloating", e); }
}

/** Restore the full app window (normal, not on top) when a session ends. */
async function exitFloating() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    // Restore a normal window (drops overlay level/behaviour + non-activating style).
    try { await tauriInvoke("set_fullscreen_overlay", { enable: false }); } catch { /* older build */ }
    await win.setSize(new LogicalSize(980, 700));
    await win.center();
  } catch (e) { console.error("exitFloating", e); }
}

/** Expand the floating companion back to a comfortable size (stays on top during a session). */
async function expandFloating() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    const win = getCurrentWindow();
    await win.setSize(new LogicalSize(980, 700));
    await win.center();
  } catch (e) { console.error("expandFloating", e); }
}

type Mode = "idle" | "advisory" | "autonomous";

type AnalysisResult = { guidance: string; stuck: boolean; offer: string | null };
type AutonomousResult = {
  action: string; x: number | null; y: number | null; value: string;
  scroll_direction: string; action_taken: string; task_complete: boolean; summary: string | null;
};

const API_URL  = import.meta.env.VITE_API_URL as string;
const INTERVAL = 5000;

const HOW = [
  { n: 1, t: "You start a session", d: "Pick a tool. Socrates begins watching your screen — privately." },
  { n: 2, t: "Guidance, step by step", d: "Follow along with live guidance. Ask anything about what you see." },
  { n: 3, t: "Stuck? It takes over", d: "With your OK, Socrates navigates the steps for you." },
];

export default function CoachingPage({ session, initialTool }: { session: Session; initialTool: string }) {
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

  const [qa, setQa] = useState<{ q: string; a: string | null }[]>([]);
  const [askInput, setAskInput] = useState("");
  const [asking, setAsking] = useState(false);
  const guidanceScrollRef = useRef<HTMLDivElement>(null);
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [tab, setTab] = useState<"coaching" | "chat">("coaching");

  // ── Screen capture ──
  async function captureScreen(): Promise<string> {
    if (IS_TAURI) return tauriInvoke<string>("capture_screen");
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return "";
    const ctx = canvas.getContext("2d")!;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  }

  // ── Advisory loop ──
  const analyzeScreen = useCallback(async () => {
    if (mode === "autonomous") return;
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    try {
      const screenshot = await captureScreen();
      if (!screenshot || screenshot.length < 100) {
        setError(IS_TAURI
          ? "Couldn't capture your screen. Enable Screen Recording for Socrates in System Settings → Privacy & Security, then restart the app."
          : "Couldn't capture your screen. Try restarting the session.");
        return;
      }
      setError("");
      setGuidance((g) => g || "Looking at your screen…");
      const res = await fetch(`${API_URL}/api/coaching/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ screenshot, tool }),
      });
      if (!res.ok) { setError(`Socrates couldn't analyze the screen (HTTP ${res.status}).`); return; }
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
    if (!IS_TAURI) {
      if (!navigator.mediaDevices?.getDisplayMedia) { setError("Screen sharing not supported. Use Chrome or Edge."); return; }
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        stream.getVideoTracks()[0].addEventListener("ended", () => stopSession());
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") return;
        setError("Could not share screen. On macOS, enable Screen Recording for your browser in System Settings.");
        return;
      }
    }
    setMode("advisory");
    setGuidance("Starting up — I'll have a look at your screen in a moment…");
    setOffer(null); setSummary(null); setAutonomousLog([]);
    // Become a floating, always-on-top companion so Socrates stays reachable
    // while you work in the tool you're being coached on.
    if (IS_TAURI) await enterFloating();
  }

  async function stopSession() {
    autonomousRef.current = false;
    if (intervalRef.current) clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    // Restore the full app window.
    if (IS_TAURI) await exitFloating();
    setMode("idle"); setOffer(null); setSummary(null); setGuidance("");
  }

  useEffect(() => {
    if (mode === "advisory") {
      analyzeScreen();
      intervalRef.current = setInterval(analyzeScreen, INTERVAL);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [mode, analyzeScreen]);

  // ── Autonomous ──
  async function acceptOffer() {
    setOffer(null); setMode("autonomous"); autonomousRef.current = true;
    setAutonomousLog([]); setSummary(null);
    if (IS_TAURI) {
      const win = await getTauriWindow();
      await win.setAlwaysOnTop(false); await win.hide();
    }
    await runAutonomousLoop();
    // Back to the floating advisory companion.
    if (IS_TAURI) await enterFloating();
  }

  async function runAutonomousLoop() {
    while (autonomousRef.current) {
      try {
        const screenshot = await captureScreen();
        const res = await fetch(`${API_URL}/api/coaching/autonomous`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
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
        if (data.action !== "done" && IS_TAURI) {
          try {
            await tauriInvoke("execute_action", {
              action: data.action, x: data.x, y: data.y,
              text: data.value || null, scrollDirection: data.scroll_direction || "down",
            });
          } catch (execErr) { console.error("execute_action error:", execErr); }
        }
        await new Promise((r) => setTimeout(r, 1200));
      } catch (e) {
        console.error("autonomous error", e);
        autonomousRef.current = false; setMode("advisory"); break;
      }
    }
  }

  function declineOffer() { setOffer(null); }

  // ── Inline Q&A ──
  async function askQuestion(e: React.FormEvent) {
    e.preventDefault();
    const q = askInput.trim();
    if (!q || asking) return;
    setAskInput(""); setAsking(true);
    setQa((prev) => [...prev, { q, a: null }]);
    try {
      const screenshot = await captureScreen();
      const res = await fetch(`${API_URL}/api/coaching/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ screenshot, tool, question: q, history: qa.filter((t): t is { q: string; a: string } => t.a !== null).slice(-6) }),
      });
      const data: AnalysisResult = await res.json();
      setQa((prev) => prev.map((item, i) => (i === prev.length - 1 ? { ...item, a: data.guidance } : item)));
    } catch {
      setQa((prev) => prev.map((item, i) => (i === prev.length - 1 ? { ...item, a: "Sorry — couldn't reach Socrates. Try again." } : item)));
    }
    setAsking(false);
  }

  useEffect(() => {
    const el = guidanceScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [qa, guidance]);

  const [expanded, setExpanded] = useState(false);
  async function toggleSize() {
    if (IS_TAURI) {
      if (expanded) { await enterFloating(); setExpanded(false); }
      else { await expandFloating(); setExpanded(true); }
      return;
    }
    const w = window.open(window.location.href, "socrates-companion", "width=440,height=680,resizable=yes,scrollbars=no");
    if (w) w.focus();
  }

  // ── Q&A bar (shared) ──
  const qaBar = (
    <div className="guide-qa">
      <div className="qa-label">Ask about your screen</div>
      <form className="qa-input" onSubmit={askQuestion}>
        <Icon name="eye" />
        <input value={askInput} onChange={(e) => setAskInput(e.target.value)} placeholder="What does this button do?" />
        <button type="submit" className="send-sm" disabled={!askInput.trim() || asking}><Icon name="send" /></button>
      </form>
    </div>
  );

  return (
    <div className="coach">
      {/* hidden capture elements (browser mode) */}
      <video ref={videoRef} muted playsInline style={{ display: "none" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {/* sub-tabs */}
      <div className="coach-sub">
        <button className={`coach-tab${tab === "coaching" ? " active" : ""}`} onClick={() => setTab("coaching")}><Icon name="coach" /> Coaching</button>
        <button className={`coach-tab${tab === "chat" ? " active" : ""}`} onClick={() => setTab("chat")}><Icon name="chat" /> Chat</button>
        <button className="tb-btn" style={{ marginLeft: "auto", marginRight: 0 }} onClick={toggleSize} title={expanded ? "Shrink to floating companion" : "Expand"}><Icon name="pop" /></button>
      </div>

      {tab === "chat" ? (
        <CoachingChat session={session} tool={tool} />
      ) : mode === "idle" ? (
        /* ── IDLE ── */
        <div className="coach-idle anim">
          <div className="start-panel">
            <h2>Start a <span className="ital">live coaching</span> session</h2>
            <p>Tell me which tool you want help with. I&apos;ll watch your screen and guide you step by step — and if you get stuck, I&apos;ll offer to take over.</p>
            <div className="start-row">
              <input className="field" value={tool} onChange={(e) => setTool(e.target.value)} placeholder="Which tool? (e.g. Claude, ChatGPT, Notion)"
                onKeyDown={(e) => { if (e.key === "Enter") startAdvisory(); }} />
              <button className="btn btn-primary btn-lg" onClick={startAdvisory}><Icon name="play" /> Start session</button>
            </div>
          </div>
          {error && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 12 }}>{error}</div>}
          <div className="panel" style={{ marginTop: 16 }}>
            <h4><Icon name="help" /> How live coaching works</h4>
            <div className="how-row">
              {HOW.map((h) => (
                <div key={h.n} className="how-card">
                  <div className="n">{h.n}</div>
                  <div className="t">{h.t}</div>
                  <div className="d">{h.d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ── LIVE: watching | autonomous ── */
        <>
          {mode === "autonomous" && (
            <div className="control-banner">
              <div className="control-orb"><Icon name="bolt" /></div>
              <div className="cb-tx"><div className="t">Socrates is in control</div><div className="d">Navigating {tool || "your tool"} for you · you can stop anytime</div></div>
              <button className="btn btn-danger btn-sm" onClick={stopSession}><Icon name="stop" /> Stop</button>
            </div>
          )}
          <div className="coach-live">
            {/* preview pane */}
            <div className="preview-pane">
              {mode !== "autonomous" && (
                <div className="preview-status">
                  <span className="badge live"><span className="dot" />Live · watching</span>
                  <span className="st-txt">Coaching <span className="dim">·</span> {tool || "your screen"}</span>
                  <span className="spacer" />
                  <button className="btn btn-danger btn-sm" onClick={stopSession}><Icon name="stop" /> Stop session</button>
                </div>
              )}
              <div className="preview-frame">
                {!IS_TAURI && streamRef.current ? (
                  <video autoPlay muted playsInline ref={(el) => { if (el && streamRef.current && el.srcObject !== streamRef.current) el.srcObject = streamRef.current; }} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#0d1017" }} />
                ) : (
                  <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--ink-faint)", textAlign: "center", padding: 24 }}>
                    <div>
                      <div style={{ display: "grid", placeItems: "center", marginBottom: 12 }}><Icon name="eye" size={30} /></div>
                      <div style={{ fontSize: 13, color: "var(--ink-dim)" }}>Socrates is watching your screen privately.</div>
                      <div className="mono" style={{ marginTop: 6 }}>your screen stays on your device</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* guide pane */}
            <aside className="guide-pane">
              {mode === "autonomous" ? (
                <>
                  <div className="guide-head"><Icon name="bolt" /><div className="gh-t">Action log<span className="mono">autonomous mode</span></div></div>
                  <div className="action-log">
                    {autonomousLog.map((a, i) => (
                      <div key={i} className={`log-item${i === autonomousLog.length - 1 ? " cur" : ""}`}>
                        <span className="lx"><Icon name="check" size={13} style={{ display: "inline", verticalAlign: "-2px", color: "var(--green)" }} /> {a}</span>
                      </div>
                    ))}
                    <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>Working…</div>
                  </div>
                  {qaBar}
                </>
              ) : (
                <>
                  <div className="guide-head"><Icon name="target" /><div className="gh-t">Guidance<span className="mono">{tool || "live coaching"}</span></div>
                    <button className="btn btn-danger btn-sm" style={{ marginLeft: "auto" }} onClick={stopSession}><Icon name="stop" /> End session</button>
                  </div>
                  <div className="guide-feed" ref={guidanceScrollRef}>
                    {error && <div style={{ color: "var(--red)", fontSize: 12.5 }}>{error}</div>}
                    {summary && (
                      <div className="offer-card" style={{ background: "var(--green-soft)", borderColor: "rgba(79,178,134,0.4)" }}>
                        <div className="oc-top"><div className="oc-ic" style={{ background: "var(--green-soft)", color: "var(--green)" }}><Icon name="check" /></div><h4>Done</h4></div>
                        <p>{summary}</p>
                      </div>
                    )}
                    <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink)" }}>{guidance || "Analysing your screen…"}</p>
                    {qa.map((item, i) => (
                      <div key={i} style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 12.5, color: "var(--accent-2)", background: "var(--accent-soft)", borderRadius: "10px 10px 2px 10px", padding: "7px 11px", marginLeft: "auto", width: "fit-content", maxWidth: "90%", lineHeight: 1.45 }}>{item.q}</div>
                        <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6, marginTop: 6 }}>
                          {item.a ?? <span style={{ opacity: 0.6, fontStyle: "italic" }}>looking at your screen…</span>}
                        </div>
                      </div>
                    ))}
                    {offer && (
                      <div className="offer-card">
                        <div className="oc-top"><div className="oc-ic"><Icon name="bolt" /></div><h4>Looks like you&apos;re stuck</h4></div>
                        <p>{offer}</p>
                        <div className="offer-actions">
                          <button className="btn btn-soft btn-sm" onClick={declineOffer}>No, I&apos;ve got it</button>
                          <button className="btn btn-primary btn-sm" onClick={acceptOffer}><Icon name="bolt" /> Yes, take over</button>
                        </div>
                      </div>
                    )}
                  </div>
                  {qaBar}
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

// ── Embedded chat (the "Chat" sub-tab — in-context conversation while coaching) ──
type ChatMsg = { role: "user" | "assistant"; content: string };

function CoachingChat({ session, tool }: { session: Session; tool: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: "I'm here while you work. Ask me anything about what you're doing." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, busy]);
  useEffect(() => {
    const ta = textareaRef.current; if (!ta) return;
    ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [input]);

  async function send() {
    const t = input.trim();
    if (!t || busy) return;
    setInput(""); setBusy(true);
    const next: ChatMsg[] = [...messages, { role: "user", content: t }];
    setMessages(next);
    try {
      const res = await fetch(`${API_URL}/api/chat/employee-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
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
    <div className="chat-main" style={{ flex: 1, minHeight: 0 }}>
      <div className="chat-stream" ref={listRef} style={{ padding: "18px 22px" }}>
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role === "user" ? "me" : "bot"}`}>
            <div className="av">{m.role === "user" ? "" : <Icon name="sparkle" />}</div>
            <div className="bubble">{m.content}</div>
          </div>
        ))}
        {busy && <div className="dim" style={{ fontSize: 12, fontStyle: "italic", paddingLeft: 6 }}>thinking…</div>}
      </div>
      <div className="chat-foot" style={{ padding: "0 22px 18px" }}>
        <div className="composer">
          <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKey} rows={1}
            placeholder={tool ? `Ask about ${tool}…` : "Ask anything…"} />
          <button className="send" onClick={send} disabled={!input.trim() || busy}><Icon name="send" /></button>
        </div>
      </div>
    </div>
  );
}
