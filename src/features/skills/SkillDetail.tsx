import { Check, Download, FileText, Info, Pencil, SquareTerminal, Trash2, Undo2, WandSparkles } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useSkillsContext } from "./skillsContext";
import { errorMessage } from "@/shared/lib/errors";
import { formatDate } from "@/shared/lib/format";
import { hasScripts, mentionsReferences, type Skill, skillTokens } from "./skills";
import { deleteSkill, exportSkill, restoreOriginalSkill } from "./skillStorage";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";
import { Markdown } from "@/features/markdown/Markdown";
import { SkillCost } from "./SkillCost";
import { Switch } from "@/shared/ui/Switch";
import { SkillFileTree } from "./SkillFileTree";
import { SkillInfoNotice } from "./SkillInfoNotice";
import { SkillSourcePill } from "./SkillSourcePill";

type Props = {
  skill: Skill;
  onEdit: () => void;
  onAdapt: () => void;
  // The skill changed on disk (e.g. restored), so the list has to be read again
  onChanged: () => void;
  onDeleted: () => void;
};

export function SkillDetail({ skill, onEdit, onAdapt, onChanged, onDeleted }: Props) {
  const { defaultSkillNames, setDefaultSkill, defaultCodeSkillNames, setDefaultCodeSkill } = useSkillsContext();
  const { t } = useTranslation();
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isConfirmingRestore, setIsConfirmingRestore] = useState(false);
  const [exportedTo, setExportedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const author = skill.metadata.author;
  const version = skill.metadata.version;
  const scripts = hasScripts(skill);
  const references = mentionsReferences(skill);
  const hasData = skill.license || author || version || skill.compatibility;

  async function exportZip() {
    setError(null);
    setExportedTo(null);
    try {
      setExportedTo(await exportSkill(skill.name));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function restore() {
    setError(null);
    try {
      await restoreOriginalSkill(skill.name);
      setIsConfirmingRestore(false);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      setIsConfirmingRestore(false);
    }
  }

  async function remove() {
    setError(null);
    try {
      await deleteSkill(skill.name);
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
      setIsConfirmingDelete(false);
    }
  }

  return (
    <section className="skill-pane" aria-label={t("skills.detail.label")}>
      <div className="skill-pane-header">
        <div className="skill-pane-title">
          <h3 className="mono">{skill.name}</h3>
          <SkillSourcePill source={skill.source} />
          {skill.adaptedAt && (
            <span
              className="skill-pill info"
              title={t("skills.detail.adaptedOn", { date: formatDate(skill.adaptedAt) })}
            >
              <WandSparkles size={11} strokeWidth={2.4} />
              {t("skills.detail.adapted")}
            </span>
          )}
        </div>
        <p>{skill.description}</p>
        <div className="skill-actions">
          <button type="button" className="outline-button" onClick={onEdit}>
            <Pencil size={15} strokeWidth={2} />
            {t("skills.detail.edit")}
          </button>
          <button
            type="button"
            className="outline-button"
            title={t("skills.detail.adaptTitle")}
            onClick={onAdapt}
          >
            <WandSparkles size={15} strokeWidth={2} />
            {t("skills.detail.adapt")}
          </button>
          {skill.hasOriginal && (
            <button
              type="button"
              className="outline-button"
              aria-expanded={isConfirmingRestore}
              onClick={() => setIsConfirmingRestore(true)}
            >
              <Undo2 size={15} strokeWidth={2} />
              {t("skills.detail.restore")}
            </button>
          )}
          <button type="button" className="outline-button" onClick={exportZip}>
            <Download size={15} strokeWidth={2} />
            {t("skills.detail.export")}
          </button>
          {/* The welcome screen's suggestions rely on the built-ins; they can be edited but not deleted */}
          {skill.source !== "nyra" && (
            <button
              type="button"
              className="outline-button danger"
              aria-expanded={isConfirmingDelete}
              onClick={() => setIsConfirmingDelete(true)}
            >
              <Trash2 size={15} strokeWidth={2} />
              {t("skills.detail.delete")}
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNotice title={error} />}
      {exportedTo && (
        <div role="status" className="notice success">
          <Check size={17} strokeWidth={2.2} />
          <span>
            <Trans
              i18nKey="skills.detail.exportedTo"
              values={{ path: exportedTo }}
              components={{ path: <span className="mono" /> }}
            />
          </span>
        </div>
      )}

      {isConfirmingRestore && (
        <div role="alertdialog" aria-labelledby="restore-skill-title" className="danger-confirm">
          <div className="danger-confirm-header">
            <Undo2 size={18} strokeWidth={2} />
            <span id="restore-skill-title" className="danger-confirm-title">
              {t("skills.detail.restoreTitle")}
            </span>
          </div>
          <p className="danger-confirm-text">{t("skills.detail.restoreText")}</p>
          <div className="danger-confirm-actions">
            <button type="button" className="ghost-button" onClick={() => setIsConfirmingRestore(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="primary-button padded danger" onClick={restore}>
              {t("skills.detail.restore")}
            </button>
          </div>
        </div>
      )}

      {isConfirmingDelete && (
        <div role="alertdialog" aria-labelledby="delete-skill-title" className="danger-confirm">
          <div className="danger-confirm-header">
            <Trash2 size={18} strokeWidth={2} />
            <span id="delete-skill-title" className="danger-confirm-title">
              <Trans
                i18nKey="skills.detail.deleteTitle"
                values={{ name: skill.name }}
                components={{ name: <span className="mono" /> }}
              />
            </span>
          </div>
          <p className="danger-confirm-text">{t("skills.detail.deleteText", { count: skill.files.length })}</p>
          <div className="danger-confirm-actions">
            <button type="button" className="ghost-button" onClick={() => setIsConfirmingDelete(false)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="primary-button padded danger" onClick={remove}>
              {t("skills.detail.deleteButton")}
            </button>
          </div>
        </div>
      )}

      {hasData && (
        <dl className="skill-data">
          {skill.license && (
            <div>
              <dt>{t("skills.detail.license")}</dt>
              <dd>{skill.license}</dd>
            </div>
          )}
          {author && (
            <div>
              <dt>{t("skills.detail.author")}</dt>
              <dd>{author}</dd>
            </div>
          )}
          {version && (
            <div>
              <dt>{t("skills.detail.version")}</dt>
              <dd>{version}</dd>
            </div>
          )}
          {skill.compatibility && (
            <div className="wide">
              <dt>{t("skills.detail.compatibility")}</dt>
              <dd>{skill.compatibility}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="setting-row skill-default">
        <div className="setting-row-text">
          <span className="setting-row-title">{t("skills.detail.newConversations")}</span>
          <span className="setting-row-description">{t("skills.detail.newConversationsHint")}</span>
        </div>
        <Switch
          checked={defaultSkillNames.includes(skill.name)}
          onChange={(isDefault) => setDefaultSkill(skill.name, isDefault)}
          label={t("skills.detail.newConversations")}
        />
      </div>
      <div className="setting-row skill-default">
        <div className="setting-row-text">
          <span className="setting-row-title">{t("skills.detail.newCode")}</span>
          <span className="setting-row-description">{t("skills.detail.newCodeHint")}</span>
        </div>
        <Switch
          checked={defaultCodeSkillNames.includes(skill.name)}
          onChange={(isDefault) => setDefaultCodeSkill(skill.name, isDefault)}
          label={t("skills.detail.newCode")}
        />
      </div>

      <SkillCost tokens={skillTokens(skill)} />

      {(scripts || references || skill.compatibility) && (
        <div className="skill-section">
          <h4>{t("skills.detail.compatibilityTitle")}</h4>
          {scripts && (
            <SkillInfoNotice icon={<SquareTerminal size={16} strokeWidth={2} />}>
              <Trans i18nKey="skills.detail.scripts" components={{ strong: <strong /> }} />
            </SkillInfoNotice>
          )}
          {references && (
            <SkillInfoNotice icon={<FileText size={16} strokeWidth={2} />}>
              <Trans
                i18nKey="skills.detail.references"
                components={{ strong: <strong />, code: <span className="mono" /> }}
              />
            </SkillInfoNotice>
          )}
          {skill.compatibility && (
            <SkillInfoNotice icon={<Info size={16} strokeWidth={2} />}>
              <Trans
                i18nKey="skills.detail.compatibilityNote"
                values={{ value: skill.compatibility }}
                components={{ strong: <strong />, code: <span className="mono" /> }}
              />
            </SkillInfoNotice>
          )}
        </div>
      )}

      <SkillFileTree files={skill.files} />

      <div className="skill-section">
        <h4>
          {t("skills.detail.instructions")}
          <span className="skill-section-aside">{t("skills.detail.previewAside")}</span>
        </h4>
        <div className="skill-preview" tabIndex={0} aria-label={t("skills.form.previewLabel")}>
          <Markdown>{skill.body}</Markdown>
        </div>
      </div>
    </section>
  );
}
