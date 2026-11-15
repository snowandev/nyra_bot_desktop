import { Check, FolderSearch, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/shared/i18n/i18n";
import { formatStorage } from "@/shared/lib/format";
import type { InstalledModel, LoadedModel } from "@/providers/ollamaModels";
import { ModelCapabilityIcons } from "./ModelCapabilityIcons";
import { ModelVisibilityButton } from "./ModelVisibilityButton";
import { DemandingModelButton } from "./DemandingModelButton";
import { DemandingModelPill } from "./DemandingModelPill";

type Props = {
  model: InstalledModel;
  // In memory right now, if it is
  loaded: LoadedModel | undefined;
  // For a chat model, the one new conversations start with; for an embedding one, the one that searches by meaning
  isDefault: boolean;
  // An embedding model Nyra uses on its own because none was chosen
  isInUse?: boolean;
  isNew: boolean;
  isUnloading: boolean;
  onToggleDefault: () => void;
  onUnload: () => void;
  onDelete: () => void;
};

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(currentLocale(), { hour: "2-digit", minute: "2-digit" });

// Icons on the right: show in the chat's menu, default, delete; the rest of the actions only show up when they make sense
export function InstalledModelRow(props: Props) {
  const { model, loaded, isDefault, isInUse, isNew, isUnloading, onToggleDefault, onUnload, onDelete } = props;
  const { name } = model;
  const { t } = useTranslation();
  const searches = model.isEmbedding && (isDefault || isInUse);

  return (
    <li className={`installed-model ${isNew ? "new" : ""}`}>
      <div className="installed-model-text">
        <div className="installed-model-line">
          <span className="mono installed-model-name" title={name}>
            {name}
          </span>
          {isDefault && !model.isEmbedding && (
            <span className="model-pill default">
              <Star size={11} strokeWidth={2.2} fill="currentColor" />
              {t("models.default")}
            </span>
          )}
          {!model.isEmbedding && <DemandingModelPill modelId={name} />}
          {searches && (
            <span className={`model-pill embedding ${isDefault ? "" : "auto"}`}>
              <FolderSearch size={11} strokeWidth={2.2} />
              {isDefault ? t("models.row.forSearch") : t("models.row.forSearchAuto")}
            </span>
          )}
          {isNew && !searches && (
            <span className="model-pill ok">
              <Check size={11} strokeWidth={3} />
              {t("models.row.justDownloaded")}
            </span>
          )}
          {loaded && (
            <span
              className={`memory-pill ${isUnloading ? "unloading" : ""}`}
              title={
                loaded.expiresAt
                  ? t("models.row.loadedTitle", { memory: formatStorage(loaded.memory), time: timeOf(loaded.expiresAt) })
                  : undefined
              }
            >
              <span className="memory-pill-label">
                <span className="status-dot loaded" />
                {isUnloading ? t("models.row.unloading") : t("models.row.inMemory", { memory: formatStorage(loaded.memory) })}
              </span>
              {!isUnloading && (
                <button type="button" aria-label={t("models.row.unloadLabel", { name })} onClick={onUnload}>
                  {t("models.row.unload")}
                </button>
              )}
            </span>
          )}
        </div>
        <div className="installed-model-meta">
          {[model.parameterSize, model.quantization, formatStorage(model.size)].filter(Boolean).map((detail, i) => (
            <span key={detail}>
              {i > 0 && <i aria-hidden="true" />}
              {detail}
            </span>
          ))}
          <ModelCapabilityIcons readsImages={model.supportsImages} thinks={model.thinks} />
        </div>
      </div>
      <div className="installed-model-actions">
        {/* Embedding models never show in the chat's menu; the gap keeps their control under the chat models' star */}
        {model.isEmbedding ? (
          <span className="installed-model-gap" aria-hidden="true" />
        ) : (
          <ModelVisibilityButton modelId={name} modelName={name} />
        )}
        {model.isEmbedding ? (
          <button
            type="button"
            className={`icon-button small search-toggle ${isInUse ? "auto" : ""}`}
            aria-pressed={isDefault}
            aria-label={t(
              isDefault ? "models.row.searchChosenLabel" : isInUse ? "models.row.searchAutoLabel" : "models.row.searchUseLabel",
              { name },
            )}
            title={t(
              isDefault ? "models.row.searchChosenTitle" : isInUse ? "models.row.searchAutoTitle" : "models.row.searchUseTitle",
            )}
            onClick={onToggleDefault}
          >
            <FolderSearch size={17} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            className="icon-button small default-star"
            aria-pressed={isDefault}
            aria-label={t(isDefault ? "models.isDefaultLabel" : "models.useAsDefaultLabel", { name })}
            title={isDefault ? t("models.defaultTitle") : t("models.useAsDefault")}
            onClick={onToggleDefault}
          >
            <Star size={17} strokeWidth={2} fill={isDefault ? "currentColor" : "none"} />
          </button>
        )}
        {!model.isEmbedding && <DemandingModelButton modelId={name} name={name} />}
        <button
          type="button"
          className="icon-button small delete-model"
          aria-label={t("models.row.deleteLabel", { name })}
          title={t("models.row.delete")}
          onClick={onDelete}
        >
          <Trash2 size={17} strokeWidth={2} />
        </button>
      </div>
    </li>
  );
}
