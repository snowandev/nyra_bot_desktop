import { Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ReferenceLabel() {
  const { t } = useTranslation();
  return (
    <>
      <span className="reference-label">
        <Link2 size={11} strokeWidth={2.6} aria-hidden="true" />
        {t("attachments.chip.reference")}
      </span>
      <span aria-hidden="true">·</span>
    </>
  );
}
