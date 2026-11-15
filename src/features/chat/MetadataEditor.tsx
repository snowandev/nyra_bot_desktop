import { Plus, X } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { MetadataEntry } from "@/features/skills/skills";

type Props = {
  entries: MetadataEntry[];
  onChange: (entries: MetadataEntry[]) => void;
};

export function MetadataEditor({ entries, onChange }: Props) {
  const { t } = useTranslation();
  const labelId = useId();

  function update(index: number, change: Partial<MetadataEntry>) {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...change } : entry)));
  }

  return (
    <div className="skill-field">
      <span className="skill-field-label" id={labelId}>
        {t("chat.metadata.title")} <span className="skill-field-optional">{t("chat.metadata.optional")}</span>
      </span>
      {entries.length > 0 && (
        <div className="metadata-rows" role="group" aria-labelledby={labelId}>
          {entries.map((entry, index) => (
            // The key is editable, so it can't identify the row; rows are only added at the end or removed
            <div className="metadata-row" key={index}>
              <input
                className="text-input mono"
                aria-label={t("chat.metadata.key")}
                placeholder="author"
                value={entry.key}
                spellCheck={false}
                onChange={(e) => update(index, { key: e.target.value })}
              />
              <input
                className="text-input"
                aria-label={t("chat.metadata.value")}
                value={entry.value}
                onChange={(e) => update(index, { value: e.target.value })}
              />
              <button
                type="button"
                className="icon-button small"
                aria-label={
                  entry.key ? t("chat.metadata.removeNamed", { name: entry.key }) : t("chat.metadata.removeField")
                }
                onClick={() => onChange(entries.filter((_, i) => i !== index))}
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="ghost-button" onClick={() => onChange([...entries, { key: "", value: "" }])}>
        <Plus size={15} strokeWidth={2} />
        {t("chat.metadata.add")}
      </button>
    </div>
  );
}
