import { ShieldAlert } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  labels: string[];
  destination: string;
};

// A reminder under a message that went to a cloud provider with something that looked like a secret
export function SensitiveSentMark({ labels, destination }: Props) {
  const { t } = useTranslation();
  const tipId = useId();
  return (
    <span className="sensitive-sent" tabIndex={0} aria-describedby={tipId}>
      <ShieldAlert size={13} strokeWidth={2.2} />
      {t("sensitive.sent", { destination })}
      <span role="tooltip" id={tipId} className="sensitive-sent-tip">
        {t("sensitive.sentTip", { labels: labels.join(" · ") })}
      </span>
    </span>
  );
}
