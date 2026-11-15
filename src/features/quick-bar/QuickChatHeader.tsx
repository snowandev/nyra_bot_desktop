import { ExternalLink, SquarePen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandIcon } from "@/shared/ui/BrandIcon";

type Props = {
  title: string;
  // Taken up again: how long ago it was left, and "Nueva" stands out so an old topic isn't continued by mistake
  resumedMinutes: number | null;
  // Undefined while Nyra answers: the main window would get the reply half written
  onContinue?: () => void;
  onNew: () => void;
  onClose: () => void;
};

// The chat's thin top line: what it is about, and starting over or hiding the bar
export function QuickChatHeader({ title, resumedMinutes, onContinue, onNew, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <div className="quick-header">
      <BrandIcon size={16} className="quick-header-mark" />
      <span className="quick-header-title">
        {title}
        {resumedMinutes !== null && <small>· {t("quick.resumedAgo", { minutes: resumedMinutes })}</small>}
      </span>
      <button
        type="button"
        className="quick-action"
        disabled={!onContinue}
        title={onContinue ? undefined : t("quick.afterReply")}
        onClick={onContinue}
      >
        <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
        {t("quick.continueInNyra")}
      </button>
      <button
        type="button"
        className={`quick-action ${resumedMinutes !== null ? "highlighted" : ""}`}
        aria-label={t("quick.startNew")}
        onClick={onNew}
      >
        <SquarePen size={14} strokeWidth={2} aria-hidden="true" />
        {t("quick.new")}
      </button>
      <button type="button" className="quick-action icon" aria-label={t("quick.hide")} onClick={onClose}>
        <X size={16} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
