import { useId } from "react";
import { formatNumber } from "@/shared/lib/format";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  hint?: string;
  // Multi-line fields also show how much of the limit is used
  multiline?: boolean;
};

export function TextField({ label, value, onChange, maxLength, placeholder, hint, multiline = false }: Props) {
  const id = useId();
  const hintId = useId();
  const common = {
    id,
    value,
    maxLength,
    placeholder,
    "aria-describedby": hint ? hintId : undefined,
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          {...common}
          rows={5}
          className="text-input multiline"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input {...common} type="text" className="text-input" onChange={(e) => onChange(e.target.value)} />
      )}
      {(hint || multiline) && (
        <div className="field-footer">
          {hint && (
            <span id={hintId} className="field-hint">
              {hint}
            </span>
          )}
          {multiline && (
            <span className="field-counter" aria-hidden="true">
              {formatNumber(value.length)} / {formatNumber(maxLength)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
