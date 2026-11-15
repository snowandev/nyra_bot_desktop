import { Eye, Rows3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@/shared/lib/format";

type Range = { from: number; to: number };

type Props = {
  reads: Range[];
  onView: (range: Range) => void;
};

// The parts of the output the model read, at the foot of its card; each opens the viewer on those lines
export function OutputReads({ reads, onView }: Props) {
  const { t } = useTranslation();
  if (reads.length === 0) return null;
  return (
    <ul className="command-reads" aria-label={t("terminal.reads.label")}>
      {reads.map((read) => (
        <li key={`${read.from}-${read.to}`}>
          <Rows3 size={13} strokeWidth={2} aria-hidden="true" />
          <span className="text">
            {t("terminal.reads.text", { from: formatNumber(read.from), to: formatNumber(read.to) })}
          </span>
          <button
            type="button"
            className="ghost-button small"
            aria-label={t("terminal.reads.viewLines", { from: read.from, to: read.to })}
            onClick={() => onView(read)}
          >
            <Eye size={13} strokeWidth={2} aria-hidden="true" />
            {t("terminal.view")}
          </button>
        </li>
      ))}
    </ul>
  );
}
