/**
 * Coaching sessions. The list (next session, coming up, behind you), then a
 * consent screen before every session, then the call: the window shrinks to the
 * floating companion strip (RealtimeVoiceSession) until the session ends.
 */
import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useT } from "../i18n";
import { useOverview, nextSession, sessionsDone, type ApprovedTool } from "../lib/overview";
import ToolMark from "../components/ToolMark";
import RealtimeVoiceSession from "../components/RealtimeVoiceSession";
import VoiceSession from "../components/VoiceSession";
import TextCoachingPage from "./TextCoachingPage";
import { vlog } from "../lib/vlog";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

type Stage =
  | { kind: "list"; ended: boolean }
  | { kind: "consent"; tool: ApprovedTool }
  | { kind: "call"; tool: ApprovedTool }
  | { kind: "text"; tool: ApprovedTool };

export default function CoachingPage({ session, requested }: { session: Session; requested: ApprovedTool | null }) {
  const { t } = useT();
  const { data, reload } = useOverview();
  const [stage, setStage] = useState<Stage>(requested ? { kind: "consent", tool: requested } : { kind: "list", ended: false });
  const [fallback, setFallback] = useState<string | null>(null);

  function ended() {
    setFallback(null);
    setStage({ kind: "list", ended: true });
    reload(); // the call bumped this tool's session count
  }

  async function allow(tool: ApprovedTool) {
    // Never block the call on this check. macOS answers it once per process and
    // a rebuilt app's old grant still looks enabled in System Settings, so a
    // "no" here can be wrong. Ask (which registers the app and opens Settings
    // when needed) and start anyway: the call runs audio-only, says so on the
    // strip, and picks the screen up as soon as permission arrives.
    if (IS_TAURI) {
      try {
        const ok = await tauriInvoke<boolean>("screen_recording_allowed");
        if (!ok) await tauriInvoke("request_screen_recording");
      } catch (e) { vlog("CONSENT: permission check unavailable: " + String(e)); }
    }
    setStage({ kind: "call", tool });
  }

  if (stage.kind === "call") {
    return fallback === null ? (
      <RealtimeVoiceSession
        tool={stage.tool.tool_name}
        sessionTitle={stage.tool.use_case}
        onEnd={ended}
        onFallback={(reason) => setFallback(reason)}
      />
    ) : (
      <VoiceSession tool={stage.tool.tool_name} onEnd={ended} fallbackReason={fallback} />
    );
  }

  if (stage.kind === "text") {
    return <TextCoachingPage session={session} initialTool={stage.tool.tool_name} onExit={ended} />;
  }

  if (stage.kind === "consent") {
    const tool = stage.tool;
    const n = sessionsDone(data?.progress ?? [], tool.tool_name) + 1;
    return (
      <div className="pg">
        <span className="ey">{t("consent.eyebrow")}</span>
        <h1 className="t">{t("consent.title")}</h1>
        <p className="sub">{tool.use_case} · {t("home.sessionOf", { tool: tool.tool_name, n })}</p>
        <dl className="kv">
          <dt>{t("consent.seesLabel")}</dt><dd>{t("consent.sees")}</dd>
          <dt>{t("consent.doesLabel")}</dt><dd>{t("consent.does")}</dd>
          <dt>{t("consent.keepsLabel")}</dt><dd>{t("consent.keeps")}</dd>
          <dt>{t("consent.stopsLabel")}</dt><dd>{t("consent.stops")}</dd>
        </dl>
        <div className="acts">
          <button className="nbtn go" onClick={() => void allow(tool)}>{t("consent.allow")}</button>
          <button className="nbtn gh" onClick={() => setStage({ kind: "list", ended: false })}>{t("consent.notNow")}</button>
        </div>
        <p className="fine">{t("consent.askedAgain")}</p>
        <button className="linkq" onClick={() => setStage({ kind: "text", tool })}>{t("sessions.textMode")}</button>
      </div>
    );
  }

  const next = nextSession(data);
  const tools = data?.tools ?? [];
  const progress = data?.progress ?? [];
  const comingUp = tools.filter((x) => x.id !== next?.id);
  const behind = tools.filter((x) => sessionsDone(progress, x.tool_name) > 0);
  return (
    <div className="pg">
      <span className="ey">{t("sessions.eyebrow")}</span>
      <h1 className="t">{t("sessions.title")}</h1>
      <p className="sub">{t("sessions.sub")}</p>
      {stage.ended && <div className="note">{t("sessions.ended")}</div>}

      {data && !next && <p className="sub" style={{ marginTop: 30 }}>{t("sessions.empty")}</p>}
      {next && (
        <div className="card">
          <div className="card-ey">
            <ToolMark name={next.tool_name} />
            <span className="ey dim">{t("sessions.upNext", { tool: next.tool_name, n: sessionsDone(progress, next.tool_name) + 1 })}</span>
          </div>
          <h2>{next.use_case}</h2>
          <div className="acts">
            <button className="nbtn go" onClick={() => setStage({ kind: "consent", tool: next })}>{t("sessions.startSession")}</button>
          </div>
        </div>
      )}

      {comingUp.length > 0 && (
        <>
          <div className="lbl">{t("sessions.comingUp")}</div>
          {comingUp.map((x) => (
            <div className="row" key={x.id}>
              <ToolMark name={x.tool_name} />
              <div><b>{x.use_case}</b><small>{t("home.sessionOf", { tool: x.tool_name, n: sessionsDone(progress, x.tool_name) + 1 })}</small></div>
              <div className="end"><button className="nbtn gh sm" onClick={() => setStage({ kind: "consent", tool: x })}>{t("home.start")}</button></div>
            </div>
          ))}
        </>
      )}

      {behind.length > 0 && (
        <>
          <div className="lbl">{t("sessions.behind")}</div>
          {behind.map((x) => (
            <div className="row" key={x.id}>
              <ToolMark name={x.tool_name} />
              <div><b>{x.tool_name}</b><small>{t("sessions.sessionsDone", { tool: x.tool_name, count: sessionsDone(progress, x.tool_name) })}</small></div>
              <div className="end"><span className="tag ok">{t("sessions.done")}</span></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
