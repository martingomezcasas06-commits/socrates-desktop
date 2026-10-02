import { useT } from "./context";
import { LOCALES } from "./core";

/** EN / ES toggle. Styled by `.lang-switch` in desktop.css. */
export default function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useT();
  return (
    <div className={`lang-switch ${className}`.trim()} role="group" aria-label={t("common.language")}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className={l === locale ? "active" : ""}
          aria-pressed={l === locale}
          title={t(`common.languageNames.${l}`)}
          lang={l}
          onClick={() => { if (l !== locale) setLocale(l); }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
