import { FileCode, Plus, Undo2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { readAsBase64 } from "@/features/attachments/attachments";
import { useFileDrop } from "@/features/attachments/useFileDrop";
import { errorMessage } from "@/shared/lib/errors";
import { formatBytes } from "@/shared/lib/format";
import { droppedEntries, readDroppedSkills } from "./skillDrop";
import type { SkillFile } from "./skills";

// A file added in the form, saved with the skill
export type PendingFile = { path: string; data: string; size: number };

type Props = {
  // The skill's files now, without its SKILL.md
  existing: SkillFile[];
  added: PendingFile[];
  removed: string[];
  onAdd: (files: PendingFile[]) => void;
  onDiscardAdded: (path: string) => void;
  onToggleRemoved: (path: string) => void;
  // Nyra's own skills keep their files
  readOnly: boolean;
};

// Same limit as importing a skill
const MAX_BYTES = 20 * 1024 * 1024;

// The skill's own files in its form, whatever they are: loose files or whole folders, chosen or dropped, kept as
// they come. What to do with them is up to the skill's instructions. Nothing is written until the skill is saved.
export function SkillFilesEditor(props: Props) {
  const { existing, added, removed, onAdd, onDiscardAdded, onToggleRemoved, readOnly } = props;
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const existingPaths = new Set(existing.map((f) => f.path));
  const rows = [
    ...existing.map((f) => ({ path: f.path, size: f.size, kind: "existing" as const })),
    ...added.filter((f) => !existingPaths.has(f.path)).map((f) => ({ path: f.path, size: f.size, kind: "new" as const })),
  ].sort((a, b) => a.path.localeCompare(b.path));

  function add(files: PendingFile[]) {
    const total = [...existing, ...added, ...files].reduce((sum, f) => sum + f.size, 0);
    if (total > MAX_BYTES) {
      setError(t("skills.filesEditor.tooBig"));
      return;
    }
    setError(null);
    onAdd(files);
  }

  async function addChosen(list: FileList | null) {
    try {
      const files = await Promise.all(
        Array.from(list ?? []).map(async (file) => ({ path: file.name, data: await readAsBase64(file), size: file.size })),
      );
      add(files);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function addDropped(entries: FileSystemEntry[]) {
    try {
      const files = await readDroppedSkills(entries);
      add(files.map((f) => ({ path: f.path, data: f.data, size: Math.floor((f.data.length * 3) / 4) })));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // A dropped folder keeps its name and what is inside it
  const drag = useFileDrop(zone, (_files, dataTransfer) => void addDropped(droppedEntries(dataTransfer)));

  return (
    <div className="skill-field">
      <span className="skill-field-label">
        {t("skills.filesEditor.title")} <span className="skill-field-optional">{t("skills.filesEditor.optional")}</span>
      </span>
      {rows.length > 0 && (
        <ul className="skill-files" aria-label={t("skills.filesEditor.list")}>
          {rows.map((row) => {
            const isRemoved = removed.includes(row.path);
            const replaces = row.kind === "existing" && added.some((f) => f.path === row.path);
            return (
              <li key={row.path} className={isRemoved ? "removed" : ""}>
                <FileCode size={15} strokeWidth={2} aria-hidden="true" />
                <span className="mono path">{row.path}</span>
                <span className="size">{formatBytes(row.size)}</span>
                {row.kind === "new" && <span className="skill-file-tag new">{t("skills.filesEditor.new")}</span>}
                {replaces && <span className="skill-file-tag new">{t("skills.filesEditor.replaced")}</span>}
                {isRemoved && <span className="skill-file-tag">{t("skills.filesEditor.removed")}</span>}
                {!readOnly &&
                  (row.kind === "new" || replaces ? (
                    <button
                      type="button"
                      className="icon-button small"
                      aria-label={t("skills.filesEditor.dontAdd", { path: row.path })}
                      onClick={() => onDiscardAdded(row.path)}
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="icon-button small"
                      aria-label={t(isRemoved ? "skills.filesEditor.keepPath" : "skills.filesEditor.removePath", {
                        path: row.path,
                      })}
                      title={isRemoved ? t("skills.filesEditor.keep") : t("skills.filesEditor.remove")}
                      onClick={() => onToggleRemoved(row.path)}
                    >
                      {isRemoved ? <Undo2 size={14} strokeWidth={2} /> : <X size={14} strokeWidth={2} />}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
      {readOnly ? (
        <span className="field-hint">{t("skills.filesEditor.builtinFiles")}</span>
      ) : (
        <>
          <div ref={zone} className={`skill-files-drop ${drag.isDragging ? "over" : ""}`}>
            <button type="button" className="outline-button small" onClick={() => input.current?.click()}>
              <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
              {t("skills.filesEditor.add")}
            </button>
            <span className="skill-files-drop-hint">{t("skills.filesEditor.dropHint")}</span>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void addChosen(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {error && (
            <div role="alert" className="skill-field-error">
              {error}
            </div>
          )}
          <span className="field-hint">
            <Trans i18nKey="skills.filesEditor.hint" components={{ code: <span className="mono" /> }} />
          </span>
        </>
      )}
    </div>
  );
}
