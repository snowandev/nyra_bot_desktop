import { CircleAlert, Download } from "lucide-react";
import { useId, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { OLLAMA_LIBRARY_URL } from "./ollamaCatalog";
import { isValidModelName } from "@/providers/ollamaModels";
import { ExternalLink } from "@/shared/ui/ExternalLink";

type Props = {
  // Controlled, so "Editar nombre" on a failed download can put the name back here
  value: string;
  onChange: (value: string) => void;
  installed: ReadonlySet<string>;
  downloading: ReadonlySet<string>;
  onDownload: (name: string) => void;
};

function nameError(name: string, installed: ReadonlySet<string>, downloading: ReadonlySet<string>, t: TFunction) {
  if (!name) return t("models.form.nameMissing");
  if (!isValidModelName(name)) return t("models.form.nameInvalid");
  if (installed.has(name)) return t("models.form.installed", { name });
  if (downloading.has(name)) return t("models.form.downloading", { name });
  return null;
}

export function DownloadModelForm({ value, onChange, installed, downloading, onDownload }: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();

  function submit() {
    const name = value.trim();
    const problem = nameError(name, installed, downloading, t);
    setError(problem);
    if (problem) return;
    onDownload(name);
    onChange("");
  }

  return (
    <>
      <form
        className="download-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="visually-hidden" htmlFor={inputId}>
          {t("models.form.nameLabel")}
        </label>
        <input
          id={inputId}
          className="text-input mono"
          placeholder={t("models.form.placeholder")}
          value={value}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={hintId}
          onChange={(e) => {
            onChange(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="primary-button padded">
          <Download size={16} strokeWidth={2.1} />
          {t("models.form.download")}
        </button>
      </form>
      {error && (
        <div className="download-form-error" role="alert">
          <CircleAlert size={14} strokeWidth={2} />
          {error}
        </div>
      )}
      <span className="field-hint" id={hintId}>
        {t("models.form.hint")} <ExternalLink href={OLLAMA_LIBRARY_URL}>{t("models.form.library")}</ExternalLink>
      </span>
    </>
  );
}
