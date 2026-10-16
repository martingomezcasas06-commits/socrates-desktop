/** Settings: who is signed in, the language, what screen sharing does, and sign out. */
import { supabase } from "../lib/supabase";
import { useT, LanguageSwitch } from "../i18n";
import { useOverview } from "../lib/overview";

export default function SettingsPage({ email, fallbackName }: { email: string; fallbackName: string }) {
  const { t } = useT();
  const { data } = useOverview();
  const u = data?.user;
  const workspace = [u?.organization, u?.workspace].filter(Boolean).join(" · ");
  return (
    <div className="pg">
      <span className="ey">{t("settings.eyebrow")}</span>
      <h1 className="t">{t("settings.title")}</h1>
      <dl className="kv">
        <dt>{t("settings.signedInAs")}</dt><dd>{u?.name || fallbackName}<span className="kv-sub">{email}</span></dd>
        {u && <><dt>{t("settings.role")}</dt><dd>{t(`nav.roles.${u.role}`)}</dd></>}
        {workspace && <><dt>{t("settings.workspace")}</dt><dd>{workspace}</dd></>}
        <dt>{t("settings.language")}</dt><dd><LanguageSwitch className="kv-lang" /></dd>
        <dt>{t("settings.screenSharing")}</dt><dd>{t("settings.screenSharingValue")}</dd>
        <dt>{t("settings.outside")}</dt><dd>{t("settings.outsideValue")}</dd>
      </dl>
      <div className="acts">
        <button className="nbtn gh" onClick={() => supabase.auth.signOut()}>{t("settings.signOut")}</button>
      </div>
    </div>
  );
}
