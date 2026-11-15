import { Import, LoaderCircle, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useFileDrop } from "@/features/attachments/useFileDrop";
import { errorMessage } from "@/shared/lib/errors";
import { i18n } from "@/shared/i18n/i18n";
import { droppedEntries, readDroppedSkills } from "./skillDrop";
import { isImportable, type SkillCandidate, type SkillImportResult, type SkippedSkill } from "./skills";
import { importSkills, pickSkillArchives, pickSkillFolder, scanClaudeCodeSkills, stageDroppedSkills } from "./skillStorage";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";
import { LoadingButton } from "@/shared/ui/LoadingButton";
import { SkillCandidateList } from "./SkillCandidateList";

type Tab = "claude-code" | "file";

type Props = {
  onImported: (results: SkillImportResult[], skipped: SkippedSkill[]) => void;
  onCancel: () => void;
};

// Selected by default: everything that can be imported. Conflicts too; the result asks before replacing.
const importableIds = (candidates: SkillCandidate[]) => candidates.filter(isImportable).map((c) => c.id);

// The same id can come back when a folder is picked twice; the newest copy wins
function merge(current: SkillCandidate[], added: SkillCandidate[]) {
  const addedIds = new Set(added.map((c) => c.id).filter(Boolean));
  return [...current.filter((c) => !addedIds.has(c.id)), ...added];
}

function skippedOf(candidates: SkillCandidate[]): SkippedSkill[] {
  return candidates.flatMap((c) => {
    if (c.status === "invalid") return [{ name: c.name, reason: c.reason ?? i18n.t("skills.importer.invalid") }];
    if (c.status === "imported") return [{ name: c.name, reason: i18n.t("skills.importer.unchanged") }];
    return [];
  });
}

export function SkillImport({ onImported, onCancel }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("claude-code");
  const [fromClaudeCode, setFromClaudeCode] = useState<SkillCandidate[] | null>(null);
  const [fromFiles, setFromFiles] = useState<SkillCandidate[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isBusy, setIsBusy] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const drag = useFileDrop(zoneRef, (_files, dataTransfer) => {
    const entries = droppedEntries(dataTransfer);
    if (entries.length > 0) run(async () => addFound("file", await stageDroppedSkills(await readDroppedSkills(entries))));
  });

  useEffect(() => {
    let cancelled = false;
    scanClaudeCodeSkills()
      .then((found) => {
        if (cancelled) return;
        setFromClaudeCode(found);
        setSelected((current) => new Set([...current, ...importableIds(found)]));
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const candidates = tab === "claude-code" ? (fromClaudeCode ?? []) : fromFiles;
  const chosen = candidates.filter((c) => isImportable(c) && selected.has(c.id));

  async function run(action: () => Promise<void>) {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsBusy(false);
    }
  }

  function addFound(target: Tab, found: SkillCandidate[] | null) {
    if (!found) return;
    if (target === "claude-code") setFromClaudeCode((current) => merge(current ?? [], found));
    else setFromFiles((current) => merge(current, found));
    setSelected((current) => new Set([...current, ...importableIds(found)]));
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(select: boolean) {
    const ids = importableIds(candidates);
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  async function importChosen() {
    setIsImporting(true);
    setError(null);
    try {
      const results = await importSkills(chosen.map((c) => c.id));
      onImported(results, skippedOf(candidates));
    } catch (e) {
      setError(errorMessage(e));
      setIsImporting(false);
    }
  }

  return (
    <section className="skill-pane" aria-label={t("skills.importer.title")}>
      <div className="skill-pane-header">
        <div className="skill-pane-title">
          <h3>{t("skills.importer.title")}</h3>
        </div>
        <p>
          <Trans i18nKey="skills.importer.intro" components={{ code: <span className="mono" /> }} />
        </p>
      </div>

      <div className="skill-tabs" role="tablist" aria-label={t("skills.importer.sources")}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "claude-code"}
          onClick={() => setTab("claude-code")}
        >
          {t("skills.importer.fromClaudeCode")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "file"} onClick={() => setTab("file")}>
          {t("skills.importer.fromFile")}
        </button>
      </div>

      {error && <ErrorNotice title={error} />}

      {tab === "claude-code" && !fromClaudeCode && !error && (
        <div role="status" className="import-loading">
          <LoaderCircle size={17} strokeWidth={2.4} className="spin info" />
          {t("skills.importer.searching")}
        </div>
      )}

      {tab === "claude-code" && fromClaudeCode?.length === 0 && (
        <div className="empty-box">
          <SquareTerminal size={26} strokeWidth={1.4} />
          <span className="empty-box-title">{t("skills.importer.noneFound")}</span>
        </div>
      )}

      {/* Always mounted (hidden on the other tab), so the drop listeners are attached from the start */}
      <div
        ref={zoneRef}
        hidden={tab !== "file"}
        className={`skill-drop-zone ${drag.isDragging ? "dragging" : ""}`}
        role="group"
        aria-label={t("skills.importer.dropZone")}
      >
        <Import size={28} strokeWidth={1.8} />
        <span className="skill-drop-title">{t("skills.importer.dropTitle")}</span>
        <span className="skill-drop-text">
          <Trans i18nKey="skills.importer.dropText" components={{ code: <span className="mono" /> }} />
        </span>
        {isBusy && (
          <span role="status" className="import-loading">
            <LoaderCircle size={17} strokeWidth={2.4} className="spin info" />
            {t("skills.importer.reading")}
          </span>
        )}
        <div className="skill-drop-actions">
          <button
            type="button"
            className="primary-button padded"
            disabled={isBusy}
            onClick={() => run(async () => addFound("file", await pickSkillArchives()))}
          >
            {t("skills.importer.chooseFiles")}
          </button>
          <button
            type="button"
            className="outline-button"
            disabled={isBusy}
            onClick={() => run(async () => addFound("file", await pickSkillFolder(false)))}
          >
            {t("skills.importer.chooseFolder")}
          </button>
        </div>
      </div>

      {candidates.length > 0 && (
        <SkillCandidateList candidates={candidates} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
      )}

      {tab === "claude-code" && fromClaudeCode && (
        <span className="field-hint">
          <Trans i18nKey="skills.importer.searchedIn" components={{ code: <span className="mono" /> }} />{" "}
          <button
            type="button"
            className="link-button inline"
            disabled={isBusy}
            onClick={() => run(async () => addFound("claude-code", await pickSkillFolder(true)))}
          >
            {t("skills.importer.searchElsewhere")}
          </button>
        </span>
      )}

      <div className="skill-form-footer">
        <button type="button" className="ghost-button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        {isImporting ? (
          <LoadingButton>{t("skills.importer.importing")}</LoadingButton>
        ) : (
          <button type="button" className="primary-button padded" disabled={chosen.length === 0} onClick={importChosen}>
            <Import size={16} strokeWidth={2.1} />
            {t("skills.importer.importCount", { count: chosen.length })}
          </button>
        )}
      </div>
    </section>
  );
}
