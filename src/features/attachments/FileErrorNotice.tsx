import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { RemoveButton } from "@/shared/ui/RemoveButton";

type Props = {
  error: { message: string; help?: string };
  onDismiss: () => void;
};

// A file that couldn't be attached, and what can be
export function FileErrorNotice({ error, onDismiss }: Props) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="composer-error">
      <CircleAlert size={16} strokeWidth={2} />
      <span className="composer-error-text">
        <strong>{error.message}</strong>
        {error.help && <span className="composer-error-help"> {error.help}</span>}
      </span>
      <RemoveButton label={t("attachments.composer.closeError")} onClick={onDismiss} />
    </div>
  );
}
