import { Check, CircleX, X } from "lucide-react";
import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { formatDate, formatNumber } from "@/shared/lib/format";
import { DESCRIPTION_MAX, isValidName, type MetadataEntry, NAME_RULES, type Skill, skillTokens, suggestName } from "./skills";
import { saveSkill, updateSkillFiles } from "./skillStorage";
import { type PendingFile, SkillFilesEditor } from "./SkillFilesEditor";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";
import { Markdown } from "@/features/markdown/Markdown";
import { joinedList } from "@/features/chat/listFormat";
import { MetadataEditor } from "@/features/chat/MetadataEditor";
import { SkillSourcePill } from "./SkillSourcePill";

type Props = {
  // undefined creates a new skill
  skill: Skill | undefined;
  // Names already taken, so a new or renamed skill can't overwrite another one
  takenNames: string[];
  onSaved: (name: string) => void;
  onCancel: () => void;
};

export function SkillForm({ skill, takenNames, onSaved, onCancel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [license, setLicense] = useState(skill?.license ?? "");
  const [metadata, setMetadata] = useState<MetadataEntry[]>(() =>
    Object.entries(skill?.metadata ?? {}).map(([key, value]) => ({ key, value })),
  );
  // A new skill starts from a short template in the interface's language; once saved it is the user's text
  const [body, setBody] = useState(() => skill?.body ?? t("skills.form.newBody"));
  const [addedFiles, setAddedFiles] = useState<PendingFile[]>([]);
  const [removedFiles, setRemovedFiles] = useState<string[]>([]);
  const [tab, setTab] = useState<"write" | "preview">("write");
  // Errors stay quiet until the first save attempt, so an empty new form doesn't start in red
  const [hasTriedToSave, setHasTriedToSave] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ids = { name: useId(), description: useId(), license: useId(), nameError: useId(), descriptionError: useId() };

  // The welcome screen's suggestions point to the built-ins by name, so theirs can't change
  const isBuiltin = skill?.source === "nyra";
  const isTaken = name !== skill?.name && takenNames.includes(name);
  const nameError = !isValidName(name)
    ? t("skills.form.nameError")
    : isTaken
      ? t("skills.form.nameTaken")
      : null;
  const trimmedDescription = description.trim();
  const descriptionError = !trimmedDescription
    ? t("skills.form.descriptionMissing")
    : trimmedDescription.length > DESCRIPTION_MAX
      ? t("skills.form.descriptionTooLong", { max: formatNumber(DESCRIPTION_MAX) })
      : null;
  const suggestion = suggestName(name);
  const canSuggest = !isValidName(name) && suggestion && isValidName(suggestion) && suggestion !== name;
  const showNameError = !!nameError && (hasTriedToSave || name.length > 0);
  const showDescriptionError = !!descriptionError && (hasTriedToSave || description.length > DESCRIPTION_MAX);
  const invalidFields = [
    nameError && t("skills.form.theName"),
    descriptionError && t("skills.form.theDescription"),
  ].filter((field): field is string => !!field);

  async function save() {
    setHasTriedToSave(true);
    if (invalidFields.length > 0 || isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveSkill(skill?.name ?? null, {
        name,
        description: trimmedDescription,
        license: license.trim(),
        metadata: metadata.filter((m) => m.key.trim()).map((m) => ({ key: m.key.trim(), value: m.value })),
        body,
      });
      if (addedFiles.length > 0 || removedFiles.length > 0) {
        await updateSkillFiles(
          name,
          addedFiles.map(({ path, data }) => ({ path, data })),
          removedFiles,
        );
      }
      onSaved(name);
    } catch (e) {
      setSaveError(errorMessage(e));
      setIsSaving(false);
    }
  }

  return (
    <section className="skill-pane" aria-label={skill ? t("skills.form.edit") : t("skills.new")}>
      <div className="skill-pane-header">
        <div className="skill-pane-title">
          <h3>{skill ? t("skills.form.edit") : t("skills.new")}</h3>
          {skill && <SkillSourcePill source={skill.source} />}
        </div>
        <p>
          <Trans i18nKey="skills.form.intro" components={{ code: <span className="mono" /> }} />
        </p>
      </div>

      {hasTriedToSave && invalidFields.length > 0 && (
        <div role="alert" className="skill-error-summary">
          <CircleX size={16} strokeWidth={2} />
          <span>
            <strong>{t("skills.form.review", { count: invalidFields.length })}</strong> {joinedList(invalidFields)}.
          </span>
        </div>
      )}
      {saveError && <ErrorNotice title={saveError} />}

      <form
        className="skill-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="skill-field">
          <label className="skill-field-label" htmlFor={ids.name}>
            {t("skills.form.name")}
          </label>
          <input
            id={ids.name}
            className="text-input mono"
            value={name}
            readOnly={isBuiltin}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={showNameError}
            aria-describedby={showNameError ? ids.nameError : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          {showNameError && (
            <div className="skill-field-error" id={ids.nameError}>
              {nameError}
              {canSuggest && (
                <button type="button" className="link-button" onClick={() => setName(suggestion)}>
                  {t("skills.form.useSuggestion", { name: suggestion })}
                </button>
              )}
            </div>
          )}
          {isBuiltin ? (
            <span className="field-hint">{t("skills.form.builtinName")}</span>
          ) : (
            <>
              <ul className="name-rules" aria-label={t("skills.form.nameRules")}>
                {NAME_RULES.map((rule) => {
                  const passes = rule.test(name);
                  return (
                    <li key={rule.id} className={passes ? "pass" : name ? "fail" : undefined}>
                      {passes ? <Check size={13} strokeWidth={2.6} /> : <X size={13} strokeWidth={2.6} />}
                      {t(`skills.nameRules.${rule.id}`)}
                    </li>
                  );
                })}
              </ul>
              <span className="field-hint">{t("skills.form.folderName")}</span>
            </>
          )}
        </div>

        <div className="skill-field">
          <label className="skill-field-label" htmlFor={ids.description}>
            {t("skills.form.description")}
            <span className={`skill-field-counter ${description.length > DESCRIPTION_MAX ? "over" : ""}`}>
              {formatNumber(description.length)} / {formatNumber(DESCRIPTION_MAX)}
            </span>
          </label>
          <textarea
            id={ids.description}
            className="text-input multiline"
            rows={4}
            value={description}
            aria-invalid={showDescriptionError}
            aria-describedby={ids.descriptionError}
            onChange={(e) => setDescription(e.target.value)}
          />
          {showDescriptionError && <div className="skill-field-error">{descriptionError}</div>}
          <span className="field-hint" id={ids.descriptionError}>
            <Trans i18nKey="skills.form.descriptionHint" components={{ strong: <strong /> }} />
          </span>
        </div>

        <div className="skill-field">
          <label className="skill-field-label" htmlFor={ids.license}>
            {t("skills.form.license")} <span className="skill-field-optional">{t("skills.form.optional")}</span>
          </label>
          <input
            id={ids.license}
            className="text-input"
            value={license}
            placeholder="MIT"
            onChange={(e) => setLicense(e.target.value)}
          />
        </div>

        <MetadataEditor entries={metadata} onChange={setMetadata} />

        <div className="skill-field">
          <span className="skill-field-label">{t("skills.form.instructions")}</span>
          <div>
            <div className="skill-tabs" role="tablist" aria-label={t("skills.form.editor")}>
              <button type="button" role="tab" aria-selected={tab === "write"} onClick={() => setTab("write")}>
                {t("skills.form.write")}
              </button>
              <button type="button" role="tab" aria-selected={tab === "preview"} onClick={() => setTab("preview")}>
                {t("skills.form.preview")}
              </button>
            </div>
            {tab === "write" ? (
              <textarea
                className="text-input multiline skill-editor"
                aria-label={t("skills.form.markdownLabel")}
                rows={12}
                spellCheck={false}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            ) : (
              <div className="skill-preview attached" tabIndex={0} aria-label={t("skills.form.previewLabel")}>
                <Markdown>{body}</Markdown>
              </div>
            )}
          </div>
          <span className="field-hint">
            {t("skills.form.tokensHint", { tokens: formatNumber(skillTokens({ name, description, body })) })}
          </span>
        </div>

        <SkillFilesEditor
          existing={(skill?.files ?? []).filter((f) => f.path !== "SKILL.md")}
          added={addedFiles}
          removed={removedFiles}
          onAdd={(files) =>
            setAddedFiles((current) => [...current.filter((f) => !files.some((n) => n.path === f.path)), ...files])
          }
          onDiscardAdded={(path) => setAddedFiles((current) => current.filter((f) => f.path !== path))}
          onToggleRemoved={(path) =>
            setRemovedFiles((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path]))
          }
          readOnly={isBuiltin}
        />

        <div className="skill-form-footer">
          {skill?.editedAt && (
            <span className="skill-form-footer-note">
              {t("skills.form.lastEdited", { date: formatDate(skill.editedAt) })}
            </span>
          )}
          <button type="button" className="ghost-button" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            className="primary-button padded"
            aria-disabled={invalidFields.length > 0 || isSaving}
          >
            {isSaving ? t("skills.form.saving") : t("skills.form.save")}
          </button>
        </div>
      </form>
    </section>
  );
}
