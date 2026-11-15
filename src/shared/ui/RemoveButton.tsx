import { X } from "lucide-react";

type Props = {
  label: string;
  onClick: () => void;
};

export function RemoveButton({ label, onClick }: Props) {
  return (
    <button type="button" className="remove-button" aria-label={label} onClick={onClick}>
      <X size={14} strokeWidth={2.2} />
    </button>
  );
}
