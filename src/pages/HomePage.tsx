/**
 * Home. For employees: one ask box, a "Coaching session" picker, and the next
 * session. For admins and chiefs: what is waiting on them (reviewed on the web).
 */
import { useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import { useT } from "../i18n";
import { useOverview, firstName, nextSession, sessionsDone, type ApprovedTool } from "../lib/overview";
import { openExternal } from "../lib/openExternal";
import ToolMark from "../components/ToolMark";

const API_URL = import.meta.env.VITE_API_URL as string;

function greetingKey(d = new Date()): "morning" | "afternoon" | "evening" {
  const h = d.getHours();
  return h < 12 ? "morning" : h < 19 ? "afternoon" : "evening";
}

export default function HomePage({ fallbackName, onAsk, onStartCoaching }: {
  fallbackName: string;
  onAsk: (text: string) => void;
  onStartCoaching: (tool: ApprovedTool) => void;
}) {
  const { t } = useT();
  const { data } = useOverview();
  const name = firstName(data?.user.name || fallbackName);
  const greeting = t(`home.greeting.${greetingKey()}`, { name });

  if (data && data.user.role !== "employee") return <AdminHome greeting={greeting} />;

  const next = nextSession(data);
  return (
    <div className="home">
      <h1 className="hello"><img src="/socrates-logo.svg" alt="" />{greeting}</h1>
      <AskBox onAsk={onAsk} onStartCoaching={onStartCoaching} autoFocus />
      {next ? (
        <div className="sess">
          <ToolMark name={next.tool_name} />
          <div className="sess-tx">
            <b>{next.use_case}</b>
            <small>{t("home.nextStrip", { tool: next.tool_name, n: sessionsDone(data!.progress, next.tool_name) + 1 })}</small>
          </div>
          <button className="nbtn go sm" onClick={() => onStartCoaching(next)}>{t("home.start")}</button>
        </div>
      ) : data ? (
        <p className="home-note">{t("home.noToolsYet")}</p>
      ) : null}
    </div>
  );
}

/** The ask box, shared by Home and the chat thread. */
export function AskBox({ onAsk, onStartCoaching, autoFocus, disabled }: {
  onAsk: (text: string) => void;
  onStartCoaching: (tool: ApprovedTool) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const { t, locale } = useT();
  const { data } = useOverview();
  const [text, setText] = useState("");
  const [pop, setPop] = useState<"up" | "down" | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [pop]);

  const tools = (data?.tools ?? []).map((x) => x.tool_name).slice(0, 3);
  const placeholder = tools.length
    ? t("home.askAbout", { tools: new Intl.ListFormat(locale, { type: "disjunction" }).format(tools) })
    : t("home.askAnything");

  function submit() {
    const v = text.trim();
    if (!v || disabled) return;
    setText("");
    onAsk(v);
  }
  function openPop(e: React.MouseEvent) {
    e.stopPropagation();
    const top = boxRef.current?.getBoundingClientRect().top ?? 0;
    setPop((p) => (p ? null : top > 320 ? "up" : "down"));
  }

  const next = nextSession(data);
  return (
    <div className="box" ref={boxRef}>
      <textarea
        value={text} autoFocus={autoFocus} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <div className="bt">
        <div>
          {data && data.tools.length > 0 && (
            <button className="cbtn" onClick={openPop}><Icon name="video" size={15} />{t("home.coachingSession")}</button>
          )}
        </div>
        <button className="nsend" title={t("home.send")} onClick={submit} disabled={!text.trim() || disabled}>
          <Icon name="arrow" />
        </button>
      </div>
      {pop && data && (
        <div className={`pop ${pop}`} onClick={(e) => e.stopPropagation()}>
          <div className="pophd">{t("home.popTitle")}</div>
          {data.tools.map((tool) => (
            <button key={tool.id} onClick={() => { setPop(null); onStartCoaching(tool); }}>
              <ToolMark name={tool.tool_name} small />
              <div className="pop-tx">
                <b>{tool.use_case}</b>
                <small>{t("home.sessionOf", { tool: tool.tool_name, n: sessionsDone(data.progress, tool.tool_name) + 1 })}</small>
              </div>
              {next?.id === tool.id && <span className="nx">{t("home.next")}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminHome({ greeting }: { greeting: string }) {
  const { t } = useT();
  const { data } = useOverview();
  const waiting = data?.waiting ?? [];
  const reviewPath = data?.user.role === "admin" ? "/admin/approvals" : "/chief/approvals";
  return (
    <div className="pg">
      <span className="ey">{t("nav.home")}</span>
      <h1 className="t">{greeting}</h1>
      <p className="sub">{waiting.length ? t("home.adminSub", { count: waiting.length }) : t("home.adminNone")}</p>
      {waiting.length > 0 && (
        <>
          <div className="lbl">{t("home.waitingOnYou")}</div>
          {waiting.map((w) => (
            <div className="row" key={w.id}>
              <ToolMark name={w.tool_name} />
              <div><b>{t("home.forPerson", { tool: w.tool_name, person: w.person })}</b></div>
              <div className="end">
                <button className="nbtn gh sm" title={t("nav.opensInBrowser", { label: t("home.review") })} onClick={() => void openExternal(`${API_URL}${reviewPath}`)}>{t("home.review")}</button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
