import { useTranslation } from "react-i18next";
import type { JsonShapes } from "./jsonFormat";
import type { CodeView } from "./useCodeViews";

type Props = {
  kind: "json" | "code";
  // For JSON: whether it is valid, and whether it fits on one line (not with comments)
  json: JsonShapes | null;
  view: CodeView;
  onChange: (view: CodeView) => void;
  formatting: boolean;
  // The formatter's own words when it couldn't read the code
  error: string | null;
};

// «Original · Formateado», and «Compacto» for JSON; for JSON that isn't valid, where it breaks
export function CodeViewSwitch({ kind, json, view, onChange, formatting, error }: Props) {
  const { t } = useTranslation();
  if (json && !json.ok) {
    return (
      <span className="code-format-note" role="note">
        {t("markdown.format.invalidJson", { line: json.line, column: json.column })}
      </span>
    );
  }
  const views: CodeView[] =
    kind === "json" && json?.ok && json.compact !== null ? ["original", "formatted", "compact"] : ["original", "formatted"];
  return (
    <>
      <div className="code-block-tabs" role="group" aria-label={t("markdown.format.label")}>
        {views.map((option) => (
          <button key={option} type="button" aria-pressed={view === option} onClick={() => onChange(option)}>
            {t(`markdown.format.${option}`)}
          </button>
        ))}
      </div>
      {formatting && (
        <span className="code-format-note" role="status">
          {t("markdown.format.formatting")}
        </span>
      )}
      {error && (
        <span className="code-format-note failed" role="alert" title={error}>
          {t("markdown.format.failed")}
        </span>
      )}
    </>
  );
}
