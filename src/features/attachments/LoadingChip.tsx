import { useTranslation } from "react-i18next";
import { RemoveButton } from "@/shared/ui/RemoveButton";

type Props = {
  name: string;
  // What is happening, e.g. "Leyendo PDF…" or "Leyendo página…"
  label: string;
  detail?: string;
  // Without it, only the spinner shows that it is working
  percent?: number;
  // Something the user has to do before it goes on, like downloading a model
  action?: { label: string; onClick: () => void };
  onCancel: () => void;
};

// A file or page still being read in the composer: it can be cancelled and holds sending back until it is ready
export function LoadingChip({ name, label, detail, percent, action, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <div className="attachment-chip loading" title={name}>
      <span className="attachment-chip-spinner" aria-hidden="true">
        <svg className="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2.6" strokeLinecap="round">
          <circle cx="12" cy="12" r="8.5" className="spinner-track" />
          <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" className="spinner-arc" />
        </svg>
      </span>
      <span className="attachment-chip-text">
        <span className="attachment-chip-name">{name}</span>
        <span role="status" className="attachment-chip-progress">
          <span className="attachment-chip-progress-label">
            <b>{label}</b>
            {detail && <span>{detail}</span>}
          </span>
          {percent !== undefined && (
            <span className="progress-bar">
              <span style={{ width: `${Math.max(4, percent)}%` }} />
            </span>
          )}
        </span>
        {action && (
          <button type="button" className="primary-button small attachment-chip-action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </span>
      <RemoveButton label={t("ui.remove", { name })} onClick={onCancel} />
    </div>
  );
}
