import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  // From 0
  current: number;
  total: number;
  onSelect: (version: number) => void;
};

// ‹ 2/3 ›: the versions a reply got by regenerating, each with the model that wrote it
export function ReplyVersionSwitcher({ current, total, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <div className="version-switcher" role="group" aria-label={t("chat.versions.label")}>
      <button
        type="button"
        className="icon-button small"
        aria-label={t("chat.versions.previous")}
        title={t("chat.versions.previous")}
        disabled={current === 0}
        onClick={() => onSelect(current - 1)}
      >
        <ChevronLeft size={16} strokeWidth={2} />
      </button>
      <span className="version-switcher-count" aria-live="polite">
        {current + 1}/{total}
      </span>
      <button
        type="button"
        className="icon-button small"
        aria-label={t("chat.versions.next")}
        title={t("chat.versions.next")}
        disabled={current === total - 1}
        onClick={() => onSelect(current + 1)}
      >
        <ChevronRight size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
