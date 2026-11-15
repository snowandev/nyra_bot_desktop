import { X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { HighlightedCode } from "@/features/markdown/HighlightedCode";
import { readSkillFile } from "@/features/skills/skillStorage";
import { CopyButton } from "@/shared/ui/CopyButton";
import { Dialog } from "@/shared/ui/Dialog";
import { errorMessage } from "@/shared/lib/errors";

type Props = {
  skill: string;
  path: string;
  onClose: () => void;
};

const LANGUAGES: Record<string, string> = {
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  rb: "ruby",
  pl: "perl",
  php: "php",
  go: "go",
  rs: "rust",
  lua: "lua",
  r: "r",
};

const languageOf = (path: string) => LANGUAGES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";

// A skill's script as it is on disk, read before deciding whether to run it: someone else wrote it
export function SkillScriptViewer({ skill, path, onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    readSkillFile(skill, path)
      .then((text) => !cancelled && setCode(text))
      .catch((e: unknown) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [skill, path]);

  return (
    <Dialog onClose={onClose} labelledBy={titleId} className="command-viewer">
      <div className="command-viewer-head">
        <span className="title">
          <b id={titleId}>
            <span className="mono">{path}</span>
          </b>
          <small>{t("terminal.script.note", { skill })}</small>
        </span>
        <button type="button" className="icon-button small" aria-label={t("terminal.close")} title={t("terminal.close")} onClick={onClose}>
          <X size={16} strokeWidth={2} />
        </button>
      </div>
      <div className="skill-script-code">
        {error ? (
          <p role="alert" className="field-warning">
            {error}
          </p>
        ) : code === null ? (
          <p className="command-help">{t("terminal.script.reading")}</p>
        ) : (
          <HighlightedCode code={code} language={languageOf(path)} />
        )}
      </div>
      <div className="command-viewer-foot">
        <span className="spacer" />
        {code !== null && <CopyButton label={t("terminal.script.copy")} text={code} showLabel />}
      </div>
    </Dialog>
  );
}
