import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  summary: string;
};

export function SummaryDivider({ summary }: Props) {
  const { t } = useTranslation();
  return (
    <details className="summary-divider">
      <summary>
        <span className="line" />
        <Sparkles size={13} strokeWidth={2} />
        {t("chat.summary.divider")}
        <span className="line" />
      </summary>
      <p className="summary-text">{summary}</p>
    </details>
  );
}
