import { Check, Download, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { formatBytes } from "@/shared/lib/format";
import { readCodeFile, saveCodeFile } from "./codeStorage";

type Props = {
  conversationId: string;
  file: { path: string; size: number };
};

// The images a program draws are shown in the card; past this size only their name
const PREVIEW_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const imageTypeOf = (path: string) => IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];

function useImagePreview(conversationId: string, file: Props["file"]) {
  const [src, setSrc] = useState<string | null>(null);
  const type = imageTypeOf(file.path);
  useEffect(() => {
    if (!type || file.size > PREVIEW_BYTES) return;
    let cancelled = false;
    readCodeFile(conversationId, file.path)
      .then((data) => !cancelled && setSrc(`data:${type};base64,${data}`))
      // Without its preview the file is still listed, and saving it says why it can't be read
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [conversationId, file.path, file.size, type]);
  return src;
}

export function CodeFileRow({ conversationId, file }: Props) {
  const { t } = useTranslation();
  const preview = useImagePreview(conversationId, file);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      if (await saveCodeFile(conversationId, file.path)) setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <li className="code-file">
      {preview && <img src={preview} alt={file.path} className="code-file-preview" />}
      <div className="code-file-row">
        <FileText size={14} strokeWidth={2} aria-hidden="true" />
        <span className="code-file-name mono" title={file.path}>
          {file.path}
        </span>
        <span className="code-file-size">{formatBytes(file.size)}</span>
        <span className="spacer" />
        <button
          type="button"
          className="ghost-button small"
          aria-label={t("terminal.code.saveFile", { name: file.path })}
          onClick={() => void save()}
        >
          {saved ? <Check size={14} strokeWidth={2.2} aria-hidden="true" /> : <Download size={14} strokeWidth={2} aria-hidden="true" />}
          {saved ? t("terminal.code.saved") : t("terminal.code.save")}
        </button>
      </div>
      {error && (
        <span className="code-file-error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
