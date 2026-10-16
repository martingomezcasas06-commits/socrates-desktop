/** History: the coaching sessions behind you, per tool, newest first. */
import { useT } from "../i18n";
import { useOverview } from "../lib/overview";
import ToolMark from "../components/ToolMark";

export default function HistoryPage() {
  const { t, formatDate } = useT();
  const { data } = useOverview();
  const rows = (data?.progress ?? [])
    .filter((p) => p.session_count > 0)
    .sort((a, b) => (b.last_session_at ?? "").localeCompare(a.last_session_at ?? ""))
    .map((p) => ({ ...p, name: displayTool(p.tool, data?.tools.map((x) => x.tool_name) ?? []) }));
  return (
    <div className="pg">
      <span className="ey">{t("history.eyebrow")}</span>
      <h1 className="t">{t("history.title")}</h1>
      <div style={{ marginTop: 28 }}>
        {!rows.length && data && <p className="sub">{t("history.empty")}</p>}
        {rows.map((p) => (
          <div className="row" key={p.tool}>
            <ToolMark name={p.name} />
            <div>
              <b>{t("sessions.sessionsDone", { tool: p.name, count: p.session_count })}</b>
              {p.last_session_at && <small>{t("history.last", { date: formatDate(new Date(p.last_session_at)) })}</small>}
            </div>
            <div className="end"><span className="tag ok">{t("sessions.done")}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** coaching_progress stores lowercased names; show the approved tool's own spelling when it matches. */
function displayTool(key: string, approved: string[]): string {
  return approved.find((n) => n.trim().toLowerCase() === key) ?? key.replace(/\b\w/g, (c) => c.toUpperCase());
}
