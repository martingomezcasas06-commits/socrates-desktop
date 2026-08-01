/**
 * RealtimeVoiceSession — the GPT-realtime voice call.
 *
 * One WebRTC session straight to OpenAI's realtime model: mic audio streams
 * up, Socrates' voice streams back, turn-taking and barge-in are handled by
 * the model's own semantic voice detection. Sub-second replies — a real call.
 *
 * Screenshots are pushed INTO the live conversation as images: one when the
 * call opens, one the instant you start speaking (so he sees what you see
 * when he answers), and a periodic refresh while idle.
 *
 * Captions: the model streams its own transcript as it speaks; the orb shows it
 * as scrolling subtitles that follow the newest line.
 *
 * If the realtime session can't be established, onFallback() lets the caller
 * drop back to the classic pipeline (VoiceSession).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import PlanetOrb from "./PlanetOrb";
import { vlog } from "../lib/vlog";
import { apiFetch } from "../lib/api";
import { useSmoothText } from "../lib/useSmoothText";
import { floatWindow, restoreWindow, captureScreen, ORB_W, ORB_H, EXP_W, EXP_H } from "./VoiceSession";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const API_URL = import.meta.env.VITE_API_URL as string;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

type Turn = { role: "user" | "assistant"; content: string; itemId?: string };
type Status = "connecting" | "speaking" | "listening" | "thinking";

const STATUS_LABEL: Record<Status, string> = {
  connecting: "Connecting",
  speaking: "Speaking",
  listening: "Listening",
  thinking: "Thinking",
};

const IDLE_SHOT_MS = 10000; // periodic screen refresh while nobody is talking

// No session prop: every request mints its own fresh token via lib/api.
export default function RealtimeVoiceSession({
  tool,
  onEnd,
  onFallback,
}: {
  tool: string;
  onEnd: () => void;
  onFallback: (reason: string) => void;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [caption, setCaption] = useState("");        // live caption text, streamed
  // Rendered instead of `caption`: glides in character by character so the
  // words read as written rather than popping in a lump per delta.
  const shownCaption = useSmoothText(caption);
  const [youSaid, setYouSaid] = useState("");
  const [error, setError] = useState("");
  const [warn, setWarn] = useState("");
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [transcript, setTranscript] = useState<Turn[]>([]);
  const [typed, setTyped] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const planetRef = useRef<HTMLDivElement | null>(null);   // orb element — amplitude is written here
  const capRef = useRef<HTMLDivElement | null>(null);      // caption viewport, kept scrolled to the newest line
  const vizCtxRef = useRef<AudioContext | null>(null);
  const vizRafRef = useRef<number | null>(null);
  const latestShotRef = useRef<string>("");
  const shotTimerRef = useRef<number | null>(null);
  const idleShotRef = useRef<number>(0);
  const aliveRef = useRef(true);
  const statusRef = useRef<Status>("connecting");
  const assistantTextRef = useRef(""); // accumulates the current reply's transcript
  const activeRespRef = useRef<string | null>(null); // id of the reply we're currently showing
  const userPartialRef = useRef<Map<string, string>>(new Map()); // your speech, per item, while it transcribes

  const setStatusBoth = (s: Status) => { statusRef.current = s; setStatus(s); };
  const pushTurn = useCallback((t: Turn) => {
    setTranscript((prev) => [...prev, t]);
  }, []);

  /** Insert-or-update your own turn, keyed by the conversation item it belongs to. */
  const upsertUserTurn = useCallback((itemId: string, content: string) => {
    setTranscript((prev) => {
      const i = prev.findIndex((t) => t.itemId === itemId);
      if (i === -1) return [...prev, { role: "user", content, itemId }];
      if (prev[i].content === content) return prev;
      const next = [...prev];
      next[i] = { ...next[i], content };
      return next;
    });
  }, []);

  const send = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      try { dc.send(JSON.stringify(event)); } catch { /* channel closing */ }
    }
  }, []);

  /** Push the freshest screenshot into the conversation so the model sees "now". */
  const sendScreen = useCallback(() => {
    const shot = latestShotRef.current;
    if (!shot) return;
    idleShotRef.current = Date.now();
    send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_image", image_url: `data:image/jpeg;base64,${shot}` }],
      },
    });
  }, [send]);

  // ── Lifecycle: float the orb, connect the call ──
  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;

    (async () => {
      vlog('REALTIME: mounting (engine=realtime)');
      await floatWindow(ORB_W, ORB_H);

      // 1. Ephemeral key from our server (bumps session count, builds tutor instructions)
      let secret = "";
      let modelName = "gpt-realtime-2.1";
      try {
        const res = await apiFetch(`${API_URL}/api/coaching/realtime-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { client_secret: string; level?: string; model?: string };
        secret = data.client_secret;
        modelName = data.model ?? modelName;
        vlog('REALTIME: mint ok, model=' + data.model);
        if (data.level) setLevel(data.level);
      } catch (e) {
        vlog('REALTIME: mint FAILED → falling back to classic. ' + String(e));
        if (!cancelled) onFallback('key: ' + String(e));
        return;
      }

      // 2. Mic + WebRTC peer connection
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (cancelled) { mic.getTracks().forEach((t) => t.stop()); return; }
        micRef.current = mic;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        pc.addTrack(mic.getTracks()[0]);

        // Socrates' voice comes back as a remote track
        pc.ontrack = (e) => {
          const el = new Audio();
          el.srcObject = e.streams[0];
          el.autoplay = true;
          audioElRef.current = el;

          // Tap the voice to drive the planet. We write amplitude to a CSS
          // variable on the orb element rather than React state — this runs every
          // frame and would otherwise re-render the panel 60x a second.
          try {
            const ctx = new AudioContext();
            vizCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(e.streams[0]);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            src.connect(analyser);
            const buf = new Uint8Array(analyser.fftSize);
            let smoothed = 0;
            const tick = () => {
              if (!aliveRef.current) return;
              analyser.getByteTimeDomainData(buf);
              let sum = 0;
              for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
              const rms = Math.sqrt(sum / buf.length);
              // normalize speech-ish range and ease it so the planet glides
              const target = Math.min(1, rms * 7);
              smoothed += (target - smoothed) * (target > smoothed ? 0.5 : 0.12);
              planetRef.current?.style.setProperty("--amp", smoothed.toFixed(3));
              vizRafRef.current = requestAnimationFrame(tick);
            };
            vizRafRef.current = requestAnimationFrame(tick);
          } catch { /* visual flourish only — baseline CSS animation still runs */ }
        };

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;

        dc.onopen = () => {
          if (!aliveRef.current) return;
          vlog('REALTIME: data channel OPEN — realtime engine is live');
          // Semantic turn detection (model decides when you're done talking — this is
          // what killed our hand-tuned VAD) + user speech transcription for the chat view.
          send({
            type: "session.update",
            session: {
              type: "realtime",
              // Audio ONLY. If the model also emits a text modality, we get two
              // parallel streams (spoken-transcript + written answer) that are
              // worded differently — interleaving them made captions read like
              // nonsense that didn't match the voice.
              output_modalities: ["audio"],
              audio: {
                input: {
                  turn_detection: { type: "semantic_vad" },
                  transcription: { model: "gpt-4o-mini-transcribe" },
                },
              },
            },
          });
          // Open the call: current screen + a nudge so Socrates greets first.
          sendScreen();
          send({ type: "response.create" });
        };

        dc.onmessage = (msg) => {
          if (!aliveRef.current) return;
          let ev: {
            type?: string; delta?: string; transcript?: string;
            response_id?: string; item_id?: string;
            response?: { id?: string };
            item?: { id?: string; role?: string; type?: string; content?: { type?: string }[] };
            error?: { message?: string };
          };
          try { ev = JSON.parse(msg.data); } catch { return; }

          switch (ev.type) {
            case "input_audio_buffer.speech_started":
              // You started talking: he sees the screen you're talking about.
              // The server cancels whatever he was saying (barge-in), so stop
              // accepting that reply's words — otherwise the cut-off sentence
              // bleeds into the next one.
              activeRespRef.current = null;
              setStatusBoth("listening");
              sendScreen();
              break;
            case "response.created":
              activeRespRef.current = ev.response?.id ?? null;
              setStatusBoth("thinking");
              assistantTextRef.current = "";
              setCaption("");
              break;
            // The transcript of what he ACTUALLY SPEAKS — the only stream we show.
            case "response.output_audio_transcript.delta":
              // Ignore deltas from a superseded reply (barge-in leaves stragglers).
              if (ev.delta && (!ev.response_id || ev.response_id === activeRespRef.current)) {
                setStatusBoth("speaking");
                assistantTextRef.current += ev.delta;
                setCaption(assistantTextRef.current);
              }
              break;
            case "response.done": {
              const text = assistantTextRef.current.trim();
              vlog('REALTIME: reply done, ' + text.length + ' chars: "' + text.slice(0, 120) + '"');
              if (text) pushTurn({ role: "assistant", content: text });
              assistantTextRef.current = "";
              activeRespRef.current = null;
              if (statusRef.current !== "listening") setStatusBoth("listening");
              break;
            }
            // Your speech becomes a chat bubble the moment the turn is captured, then
            // fills in as it transcribes. Verified against the live API: the
            // transcription can land AFTER his reply, so appending on completion put
            // your question BELOW his answer. Reserving the slot early fixes the order.
            case "conversation.item.added":
              if (
                ev.item?.role === "user" &&
                ev.item?.content?.some((c) => c?.type === "input_audio") &&
                ev.item.id
              ) {
                upsertUserTurn(ev.item.id, "");
              }
              break;
            case "conversation.item.input_audio_transcription.delta":
              if (ev.item_id && ev.delta) {
                const soFar = (userPartialRef.current.get(ev.item_id) ?? "") + ev.delta;
                userPartialRef.current.set(ev.item_id, soFar);
                setYouSaid(soFar);
                upsertUserTurn(ev.item_id, soFar);
              }
              break;
            case "conversation.item.input_audio_transcription.completed":
              if (ev.item_id) {
                const finalText = (ev.transcript ?? userPartialRef.current.get(ev.item_id) ?? "").trim();
                userPartialRef.current.delete(ev.item_id);
                if (finalText) {
                  vlog('REALTIME: you said: "' + finalText.slice(0, 120) + '"');
                  setYouSaid(finalText);
                  upsertUserTurn(ev.item_id, finalText);
                }
              }
              break;
            case "error":
              console.error("realtime error", ev);
              if (ev.error?.message && !/transcription|truncat/i.test(ev.error.message)) {
                setError(ev.error.message);
              }
              break;
          }
        };

        // 3. SDP handshake with the ephemeral key
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        // The SDP handshake CANNOT go directly from the webview: posting to
        // api.openai.com from origin tauri://localhost is cross-origin and
        // WKWebView drops it with only "TypeError: Load failed" — which is what
        // sent every call to the fallback engine. Do it natively in Rust (no CORS
        // at all); in a plain browser, go through our server instead.
        let answerSdp: string;
        if (IS_TAURI) {
          answerSdp = await tauriInvoke<string>("realtime_sdp", {
            secret, model: modelName, offer: offer.sdp ?? "",
          });
          vlog('REALTIME: sdp exchange ok (native), ' + answerSdp.length + ' chars');
        } else {
          const r = await apiFetch(`${API_URL}/api/coaching/realtime-sdp?model=${encodeURIComponent(modelName)}`, {
            method: "POST",
            body: offer.sdp,
            headers: {
              "X-Realtime-Secret": secret,
              "Content-Type": "application/sdp",
            },
          });
          if (!r.ok) throw new Error(`SDP ${r.status}`);
          answerSdp = await r.text();
          vlog('REALTIME: sdp exchange ok (proxy), ' + answerSdp.length + ' chars');
        }
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });


        setStatusBoth("listening");
      } catch (e) {
        vlog('REALTIME: webrtc setup FAILED → falling back to classic. ' + String(e));
        if (!cancelled) onFallback('connect: ' + String(e));
        return;
      }

      // 4. Screen capture loop (warm frame + idle refresh into the conversation)
      if (IS_TAURI) {
        try {
          const ok = await tauriInvoke<boolean>("screen_recording_allowed");
          if (!ok) {
            try { await tauriInvoke("request_screen_recording"); } catch { /* noop */ }
            setWarn("I can't see your screen yet — turn on Screen Recording for Socrates in System Settings, then quit and reopen.");
          }
        } catch { /* older build */ }
        const grab = async () => {
          const s = await captureScreen();
          if (s) {
            latestShotRef.current = s;
            if (Date.now() - idleShotRef.current > IDLE_SHOT_MS) sendScreen();
          }
        };
        void grab();
        shotTimerRef.current = window.setInterval(grab, 2500);
      }
    })();

    return () => {
      cancelled = true;
      aliveRef.current = false;
      if (shotTimerRef.current) clearInterval(shotTimerRef.current);
      try { dcRef.current?.close(); } catch { /* noop */ }
      try { pcRef.current?.close(); } catch { /* noop */ }
      micRef.current?.getTracks().forEach((t) => t.stop());
      if (audioElRef.current) audioElRef.current.srcObject = null;
      if (vizRafRef.current) cancelAnimationFrame(vizRafRef.current);
      vizCtxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    const track = micRef.current?.getTracks()[0];
    if (track) track.enabled = !next;
  }

  async function toggleExpand() {
    const next = !expanded;
    setExpanded(next);
    await floatWindow(next ? EXP_W : ORB_W, next ? EXP_H : ORB_H);
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const t = typed.trim();
    if (!t) return;
    setTyped("");
    setYouSaid(t);
    pushTurn({ role: "user", content: t });
    sendScreen();
    send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: t }] },
    });
    send({ type: "response.create" });
  }

  useEffect(() => {
    if (expanded && feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [transcript, expanded, status]);

  // Follow the newest caption line as it streams in.
  useEffect(() => {
    const el = capRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [caption]);

  async function end() {
    aliveRef.current = false;
    if (shotTimerRef.current) clearInterval(shotTimerRef.current);
    try { dcRef.current?.close(); } catch { /* noop */ }
    try { pcRef.current?.close(); } catch { /* noop */ }
    micRef.current?.getTracks().forEach((t) => t.stop());
    await restoreWindow();
    onEnd();
  }

  const statusHead = (
    <>
      <PlanetOrb status={status} size={40} innerRef={planetRef} />
      <span className="vo-status">
        <span className="vo-status-text">{STATUS_LABEL[status]}</span>
        {level && <span className="vo-lvl">{level === "new" ? "intro" : level === "learning" ? "core" : "pro"}</span>}
      </span>
      <button className={`vo-btn${muted ? " on" : ""}`} onClick={toggleMute} title={muted ? "Unmute" : "Mute"}>
        <Icon name={muted ? "eye" : "coach"} />
      </button>
      <button className="vo-btn" onClick={toggleExpand} title={expanded ? "Shrink to orb" : "Open chat"}>
        <Icon name={expanded ? "pop" : "chat"} />
      </button>
      <button className="vo-btn end" onClick={end} title="End call"><Icon name="stop" /></button>
    </>
  );

  if (expanded) {
    return (
      <div className="voice-exp">
        <div className="ve-head">{statusHead}</div>
        <div className="ve-feed" ref={feedRef}>
          {warn && <div className="vo-warn" style={{ marginBottom: 8 }}>{warn}</div>}
          {transcript.length === 0 && !error && <div className="ve-empty">Your conversation shows up here. Talk to me, or type below.</div>}
          {transcript.map((m, i) => (
            <div key={i} className={`ve-msg ${m.role}`}>{m.content}</div>
          ))}
          {error && <div className="ve-err">{error}</div>}
        </div>
        <form className="ve-input" onSubmit={sendTyped}>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type instead of talking…" />
          <button type="submit" className="send-sm" disabled={!typed.trim()}><Icon name="send" /></button>
        </form>
      </div>
    );
  }

  return (
    <div className="voice-orb">
      <div className="vo-top">{statusHead}</div>
      {error ? (
        <div className="vo-cap"><p className="vo-cap-line vo-cap-err">{error}</p></div>
      ) : caption ? (
        // Captions scroll like real subtitles: text stays put, the view follows the
        // newest line, and the top edge fades out. No per-word animation — with a
        // streaming transcript that only made the layout jitter.
        <div className="vo-cap" aria-live="polite" ref={capRef}>
          <p className="vo-cap-line">{shownCaption}</p>
        </div>
      ) : (
        <div className="vo-cap vo-cap-soft">
          <p className="vo-cap-line">
            {status === "connecting" ? "Starting your call…" : youSaid ? `“${youSaid}”` : "Say hi, or ask me anything."}
          </p>
        </div>
      )}
      {warn && <div className="vo-warn">{warn}</div>}
    </div>
  );
}
