import { Check } from "lucide-react";

type Props = {
  checked: boolean;
};

// A task of a list the reply wrote: drawn here instead of the system's checkbox, which looks different on each one,
// and read-only, since ticking it wouldn't change the reply
export function TaskBox({ checked }: Props) {
  return (
    <span
      className={`task-box ${checked ? "checked" : ""}`}
      role="checkbox"
      aria-checked={checked}
      aria-disabled="true"
    >
      {checked && <Check size={11} strokeWidth={3.2} />}
    </span>
  );
}
