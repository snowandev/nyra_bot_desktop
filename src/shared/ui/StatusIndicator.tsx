import { useTranslation } from "react-i18next";

export type ConnectionStatus = "idle" | "loading" | "loaded" | "error";

type Props = {
  status: ConnectionStatus;
  className: string;
};

export function StatusIndicator({ status, className }: Props) {
  const { t } = useTranslation();
  return (
    <span className={className}>
      <span className={`status-dot ${status}`} />
      {t(`ui.status.${status}`)}
    </span>
  );
}
