import { Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  name: string;
  onRemove: () => void;
};

// The skill chosen for this message, first in the row of attachments: it goes with the message, like a file
export function InvokedSkillPill({ name, onRemove }: Props) {
  const { t } = useTranslation();
  return (
    <span className="invoked-skill" title={t("skills.invoked.title")}>
      <Sparkles size={14} strokeWidth={2} />
      <span className="mono">{name}</span>
      <button type="button" aria-label={t("skills.invoked.remove", { name })} onClick={onRemove}>
        <X size={13} strokeWidth={2.4} />
      </button>
    </span>
  );
}
