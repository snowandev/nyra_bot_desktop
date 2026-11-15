import { CircleAlert, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { Trans } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";

type Props = {
  icon: LucideIcon;
  initialName?: string;
  placeholder: string;
  label: string;
  max: number;
  // The counter shows up near the limit, not while there is plenty of room
  counterFrom: number;
  // The reason the name can't be saved, or null; hasTriedToSave lets an empty new field start without an error
  validate: (name: string, hasTriedToSave: boolean) => string | null;
  // Rejects with the reason when the name can't be saved
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
};

// A name written in place, where the thing lives (a sidebar folder, a project); Enter saves and Escape cancels
export function NameEditor(props: Props) {
  const { icon: Icon, initialName = "", placeholder, label, max, counterFrom, validate, onSave, onCancel } = props;
  const [name, setName] = useState(initialName);
  const [hasTriedToSave, setHasTriedToSave] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const messageId = useId();
  const error = saveError ?? validate(name, hasTriedToSave);
  const length = Array.from(name.trim()).length;

  async function save() {
    setHasTriedToSave(true);
    if (isSaving || validate(name, true)) return;
    setIsSaving(true);
    try {
      await onSave(name.trim());
    } catch (e) {
      setSaveError(errorMessage(e));
      setIsSaving(false);
    }
  }

  return (
    <div className="folder-editor">
      <div className={`folder-editor-field ${error ? "invalid" : ""}`}>
        <Icon size={15} strokeWidth={2} />
        <input
          value={name}
          autoFocus
          placeholder={placeholder}
          aria-label={label}
          aria-invalid={!!error}
          aria-describedby={messageId}
          spellCheck={false}
          autoComplete="off"
          disabled={isSaving}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setName(e.target.value);
            setSaveError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              // Only the name's: the drawer or panel around it stays open
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
        />
        {length >= counterFrom && (
          <span className={`folder-editor-counter ${length > max ? "over" : ""}`}>
            {length}/{max}
          </span>
        )}
      </div>
      <div id={messageId}>
        {error ? (
          <div className="folder-editor-error" role="alert">
            <CircleAlert size={13} strokeWidth={2} />
            <span>{error}</span>
          </div>
        ) : (
          <div className="folder-editor-hint">
            <Trans i18nKey="ui.nameEditorHint" components={{ kbd: <kbd /> }} />
          </div>
        )}
      </div>
    </div>
  );
}
