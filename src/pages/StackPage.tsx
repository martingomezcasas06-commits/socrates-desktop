/** My stack: the tools approved for you, with their real logos and why each was approved. */
import { useT } from "../i18n";
import { useOverview } from "../lib/overview";
import ToolLogo from "../components/ToolLogo";
import { openExternal } from "../lib/openExternal";

export default function StackPage() {
  const { t } = useT();
  const { data, loading } = useOverview();
  const tools = data?.tools ?? [];
  return (
    <div className="pg">
      <span className="ey">{t("stack.eyebrow")}</span>
      <h1 className="t">{t("stack.pageTitle")}</h1>
      <div style={{ marginTop: 28 }}>
        {loading && !data && <p className="sub">{t("stack.loading")}</p>}
        {data && !tools.length && <p className="sub">{t("stack.emptyBody")}</p>}
        {tools.map((tool) => (
          <div className="row tall" key={tool.id}>
            <ToolLogo name={tool.tool_name} className="lg" />
            <div>
              <b>{tool.tool_name}</b>
              <small>{tool.tool_category}</small>
              <p>{tool.reason}</p>
            </div>
            <div className="end">
              {tool.tool_url && <button className="nbtn gh sm" onClick={() => void openExternal(tool.tool_url!)}>{t("stack.open")}</button>}
              <span className="tag ok">{t("stack.readyToUse")}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
