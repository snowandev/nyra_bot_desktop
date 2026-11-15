import { Check, CircleX, type LucideIcon, Plus, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type CandidateStatus, isImportable, type SkillCandidate } from "./skills";

type Props = {
  candidates: SkillCandidate[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (select: boolean) => void;
};

// Their labels are in the catalog, under skills.candidates.statuses
const STATUSES: Record<CandidateStatus, { icon: LucideIcon; tone: string }> = {
  new: { icon: Plus, tone: "ok" },
  update: { icon: RefreshCw, tone: "info" },
  conflict: { icon: TriangleAlert, tone: "caution" },
  imported: { icon: Check, tone: "" },
  invalid: { icon: CircleX, tone: "bad" },
};

export function SkillCandidateList({ candidates, selected, onToggle, onToggleAll }: Props) {
  const { t } = useTranslation();
  const importable = candidates.filter(isImportable);
  const selectedCount = importable.filter((c) => selected.has(c.id)).length;
  const allSelected = importable.length > 0 && selectedCount === importable.length;

  return (
    <div className="skill-section">
      <div className="skill-candidates-toolbar">
        <label className="skill-check">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={importable.length === 0}
            onChange={() => onToggleAll(!allSelected)}
          />
          {t("skills.candidates.selectAll")}
        </label>
        <span>{t("skills.candidates.selected", { selected: selectedCount, total: importable.length })}</span>
      </div>
      <ul className="skill-candidates">
        {candidates.map((candidate, index) => {
          const status = STATUSES[candidate.status];
          const enabled = isImportable(candidate);
          // Invalid candidates have no id, since they can't be imported
          const key = candidate.id || `invalid-${index}-${candidate.location}`;
          return (
            <li key={key}>
              <label className={`skill-check ${enabled ? "" : "disabled"}`}>
                <input
                  type="checkbox"
                  checked={enabled && selected.has(candidate.id)}
                  disabled={!enabled}
                  onChange={() => onToggle(candidate.id)}
                />
                <span className="skill-check-text">
                  <span className="mono skill-check-name">{candidate.name || t("skills.candidates.unnamed")}</span>
                  <span className="mono skill-check-path">{candidate.location}</span>
                  {candidate.reason && <span className="skill-check-reason">{candidate.reason}</span>}
                </span>
                <span className={`skill-pill ${status.tone}`}>
                  <status.icon size={11} strokeWidth={2.4} />
                  {t(`skills.candidates.statuses.${candidate.status}`)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
