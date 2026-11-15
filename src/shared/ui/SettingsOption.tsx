import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  icon: ReactNode;
  name: string;
  status: ReactNode;
  selected: boolean;
  onSelect: () => void;
};

export function SettingsOption({ icon, name, status, selected, onSelect }: Props) {
  return (
    <button
      type="button"
      className={`settings-option ${selected ? "selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="settings-option-icon">{icon}</span>
      <span className="settings-option-text">
        <span className="settings-option-name">{name}</span>
        {status}
      </span>
      <ChevronRight size={16} strokeWidth={2} className="muted" />
    </button>
  );
}
