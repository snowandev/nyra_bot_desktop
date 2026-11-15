import { CircleCheck, CircleMinus, RefreshCw, TriangleAlert, WandSparkles } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { formatDate } from "@/shared/lib/format";
import { type SkillImportResult, type SkippedSkill } from "./skills";
import { importSkills } from "./skillStorage";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";

type Props = {
  results: SkillImportResult[];
  skipped: SkippedSkill[];
  // Skills installed by a replacement, so the list can show them
  onChanged: () => void;
  onImportMore: () => void;
  // Reviews the new skills one by one, rewritten to work with any model
  onAdapt: (names: string[]) => void;
  onDone: (firstName: string | null) => void;
};

export function SkillImportSummary(props: Props) {
  const { onChanged, onImportMore, onAdapt, onDone } = props;
  const { t } = useTranslation();
  const [results, setResults] = useState(props.results);
  const [skipped, setSkipped] = useState(props.skipped);
  const [applyToAll, setApplyToAll] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imported = results.filter((r) => r.outcome === "imported");
  const updated = results.filter((r) => r.outcome === "updated");
  const conflicts = results.filter((r) => r.outcome === "conflict");
  const conflict = conflicts[0];

  async function replace() {
    const targets = applyToAll ? conflicts : [conflict];
    const ids = targets.map((r) => r.id);
    setIsReplacing(true);
    setError(null);
    try {
      const replaced = await importSkills(ids, ids);
      const byId = new Map(replaced.map((r) => [r.id, r]));
      setResults((current) => current.map((r) => byId.get(r.id) ?? r));
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setIsReplacing(false);
    }
  }

  function keep() {
    const targets = applyToAll ? conflicts : [conflict];
    const ids = new Set(targets.map((r) => r.id));
    setResults((current) => current.filter((r) => !ids.has(r.id)));
    setSkipped((current) => [...current, ...targets.map((r) => ({ name: r.name, reason: t("skills.summary.keptNyras") }))]);
  }

  return (
    <section className="skill-pane" aria-label={t("skills.summary.label")}>
      <div className="skill-pane-header">
        <div className="skill-pane-title">
          <h3>{conflicts.length > 0 ? t("skills.summary.almostDone") : t("skills.summary.done")}</h3>
        </div>
        <div className="skill-summary-pills" role="status">
          {imported.length > 0 && (
            <span className="skill-pill ok">
              <CircleCheck size={11} strokeWidth={2.4} />
              {t("skills.summary.imported", { count: imported.length })}
            </span>
          )}
          {updated.length > 0 && (
            <span className="skill-pill info">
              <RefreshCw size={11} strokeWidth={2.4} />
              {t("skills.summary.updated", { count: updated.length })}
            </span>
          )}
          {skipped.length > 0 && (
            <span className="skill-pill">
              <CircleMinus size={11} strokeWidth={2.4} />
              {t("skills.summary.skipped", { count: skipped.length })}
            </span>
          )}
          {conflicts.length > 0 && (
            <span className="skill-pill caution">
              <TriangleAlert size={11} strokeWidth={2.4} />
              {t("skills.summary.pending", { n: conflicts.length })}
            </span>
          )}
        </div>
      </div>

      {error && <ErrorNotice title={error} />}

      {conflict && (
        <div className="skill-section">
          <h4>{t("skills.summary.toDecide")}</h4>
          <div className="skill-conflict" role="group" aria-labelledby="skill-conflict-title">
            <TriangleAlert size={16} strokeWidth={2} />
            <div>
              <strong id="skill-conflict-title">
                <Trans
                  i18nKey="skills.summary.exists"
                  values={{ name: conflict.name }}
                  components={{ code: <span className="mono" /> }}
                />
              </strong>{" "}
              {conflict.editedAt
                ? t("skills.summary.editedHere", { date: formatDate(conflict.editedAt) })
                : t("skills.summary.fromElsewhere")}
              <div className="skill-conflict-actions">
                <button type="button" className="outline-button danger" disabled={isReplacing} onClick={replace}>
                  {t("skills.summary.replace")}
                </button>
                <button type="button" className="outline-button" disabled={isReplacing} onClick={keep}>
                  {t("skills.summary.skip")}
                </button>
                {conflicts.length > 1 && (
                  <label className="skill-check compact">
                    <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
                    {t("skills.summary.applyAll", { n: conflicts.length })}
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {imported.length + updated.length + skipped.length > 0 && (
        <div className="skill-section">
          <h4>{t("skills.summary.details")}</h4>
          <ul className="skill-results">
            {[...imported, ...updated].map((r) => (
              <li key={r.id}>
                <span className="skill-result-text">
                  <span className="mono skill-result-name">{r.name}</span>
                  {r.detail && <span className="skill-result-reason">{r.detail}</span>}
                </span>
                <span className={`skill-pill ${r.outcome === "imported" ? "ok" : "info"}`}>
                  {r.outcome === "imported" ? (
                    <CircleCheck size={11} strokeWidth={2.4} />
                  ) : (
                    <RefreshCw size={11} strokeWidth={2.4} />
                  )}
                  {r.outcome === "imported" ? t("skills.summary.importedOne") : t("skills.summary.updatedOne")}
                </span>
              </li>
            ))}
            {skipped.map((s, index) => (
              <li key={`skipped-${index}-${s.name}`}>
                <span className="skill-result-text">
                  <span className="mono skill-result-name">{s.name}</span>
                  <span className="skill-result-reason">{s.reason}</span>
                </span>
                <span className="skill-pill">
                  <CircleMinus size={11} strokeWidth={2.4} />
                  {t("skills.summary.skippedOne")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="skill-form-footer">
        <button type="button" className="ghost-button" onClick={onImportMore}>
          {t("skills.summary.importMore")}
        </button>
        {imported.length + updated.length > 0 && (
          <button
            type="button"
            className="outline-button"
            title={t("skills.summary.adaptTitle")}
            onClick={() => onAdapt([...imported, ...updated].map((r) => r.name))}
          >
            <WandSparkles size={15} strokeWidth={2} />
            {t("skills.summary.adapt", { n: imported.length + updated.length })}
          </button>
        )}
        <button
          type="button"
          className="primary-button padded"
          onClick={() => onDone([...imported, ...updated][0]?.name ?? null)}
        >
          {t("skills.summary.seeSkills")}
        </button>
      </div>
    </section>
  );
}
