import { ShieldAlert } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { MEMORY_MAX_CHARS } from "./memories";
import { findSensitiveData } from "@/features/sensitive-data/sensitiveData";

type Props = {
  initialText: string;
  label: string;
  // Rejects with the reason it couldn't be saved, shown under the field
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
};

// The field to add or rewrite a memory in Settings
export function MemoryEditor({ initialText, label, onSave, onCancel }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const hintId = useId();
  const [text, setText] = useState(initialText);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const looksSensitive = findSensitiveData(text).length > 0;
  const canSave = text.trim().length > 0 && !isSaving;

  async function save() {
    if (!canSave) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSave(text);
    } catch (e) {
      setError(errorMessage(e));
      setIsSaving(false);
    }
  }

  // A memory is one line: Enter saves it, as in the chat's message editor
  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="memory-editor">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <textarea
        id={id}
        className="text-input multiline"
        rows={2}
        value={text}
        maxLength={MEMORY_MAX_CHARS}
        placeholder={t("memory.editor.placeholder")}
        aria-describedby={hintId}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
      />
      {looksSensitive && (
        <div className="memory-editor-sensitive" role="status">
          <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />
          {t("memory.editor.sensitive")}
        </div>
      )}
      {error && <span className="setting-row-error">{error}</span>}
      <div className="memory-editor-footer">
        <span id={hintId}>
          {t("memory.editor.hint", { length: text.length, max: MEMORY_MAX_CHARS })}
        </span>
        <button type="button" className="ghost-button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="button" className="primary-button small" disabled={!canSave} onClick={save}>
          {t("memory.editor.save")}
        </button>
      </div>
    </div>
  );
}
