import { Cpu, Download, FolderSearch, MessageSquare, RotateCw, Search, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useModelDownloadsContext } from "./modelDownloadsContext";
import type { useOllamaInventory } from "./useOllamaInventory";
import { errorMessage } from "@/shared/lib/errors";
import { formatStorage } from "@/shared/lib/format";
import { remoteHostOf } from "./network";
import { FIRST_MODEL, RECOMMENDED_EMBEDDING_MODEL } from "./ollamaCatalog";
import { usePreferencesContext } from "@/features/settings/preferencesContext";
import {
  chooseEmbeddingModel,
  deleteModel,
  embeddingModelsOf,
  type InstalledModel,
  looksLikeEmbedding,
  unloadModel,
} from "@/providers/ollamaModels";
import type { ProviderConfig } from "@/shared/types";
import { DownloadModelForm } from "./DownloadModelForm";
import { EmbeddingStatus } from "./EmbeddingStatus";
import { ErrorNotice } from "@/shared/ui/ErrorNotice";
import { InstalledModelGroup } from "./InstalledModelGroup";
import { InstalledModelRow } from "./InstalledModelRow";
import { ModelDeleteConfirm } from "./ModelDeleteConfirm";
import { ModelDownloadCard } from "./ModelDownloadCard";
import { ModelGroupEmpty } from "./ModelGroupEmpty";
import { OllamaUnavailable } from "./OllamaUnavailable";
import { SuggestedModelList } from "./SuggestedModelList";

type Props = {
  config: ProviderConfig;
  inventory: ReturnType<typeof useOllamaInventory>;
  defaultModelId: string | null;
  onDefaultModelChange: (id: string | null) => void;
};

type Note = { kind: "ok" | "info"; message: ReactNode; makeDefault?: string };

// How long a note after an action stays before going away on its own
const NOTE_MS = 7000;
// From this many models on, a filter by name helps find one
const FILTER_FROM = 10;

export function OllamaModelManager({ config, inventory, defaultModelId, onDefaultModelChange }: Props) {
  const downloads = useModelDownloadsContext();
  const { preferences, updatePreferences } = usePreferencesContext();
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [unloading, setUnloading] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [recent, setRecent] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formValue, setFormValue] = useState("");
  const [filter, setFilter] = useState("");
  const downloadTitleRef = useRef<HTMLHeadingElement>(null);
  // A download that finished while this panel was open gets a note; one from before it opened doesn't
  const [seenFinished, setSeenFinished] = useState(downloads.lastFinished?.at ?? 0);

  const { t } = useTranslation();
  const { installed, loaded } = inventory;
  const remoteHost = remoteHostOf(config.baseUrl);
  const place = remoteHost ? t("models.place.remote", { host: remoteHost }) : t("models.place.local");
  const mono = { name: <strong className="mono" /> };
  const installedNames = new Set(installed.map((m) => m.name));
  const downloadingNames = new Set(downloads.downloads.filter((d) => d.status === "active").map((d) => d.name));
  const totalSize = installed.reduce((sum, m) => sum + m.size, 0);
  const chatModels = installed.filter((m) => !m.isEmbedding);
  const embeddingModels = embeddingModelsOf(installed);
  // The embedding model that searches by meaning: the one the user marked, or the one Nyra picks without it
  const embeddingDefault = preferences.embeddingModel;
  const embeddingInUse = chooseEmbeddingModel(
    embeddingModels.map((m) => m.name),
    embeddingDefault,
  );
  // A model just downloaded can be made the chats' default only if it can chat; it may not be listed yet
  const canChat = (name: string) => !(installed.find((m) => m.name === name)?.isEmbedding ?? looksLikeEmbedding(name));
  const isDefaultOf = (model: InstalledModel) =>
    model.name === (model.isEmbedding ? embeddingDefault : defaultModelId);

  function toggleDefault(model: InstalledModel) {
    const next = isDefaultOf(model) ? null : model.name;
    if (model.isEmbedding) updatePreferences({ embeddingModel: next });
    else onDefaultModelChange(next);
  }

  const finished = downloads.lastFinished;
  if (finished && finished.at !== seenFinished) {
    setSeenFinished(finished.at);
    setRecent(finished.name);
    setNote({
      kind: "ok",
      message: (
        <Trans
          i18nKey="models.manager.downloaded"
          values={{ name: finished.name, size: formatStorage(finished.size) }}
          components={mono}
        />
      ),
      makeDefault: finished.name,
    });
  }

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => {
      setNote(null);
      setRecent(null);
    }, NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  // Another chat model takes over when the default is deleted
  const nextDefaultAfter = (name: string) => installed.find((m) => m.name !== name && !m.isEmbedding)?.name ?? null;

  async function remove(model: InstalledModel) {
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteModel(config, model.name);
      const next = model.name === defaultModelId ? nextDefaultAfter(model.name) : null;
      if (model.name === defaultModelId) onDefaultModelChange(next);
      // Without its default, Nyra picks one of the embedding models left on its own
      if (model.name === embeddingDefault) updatePreferences({ embeddingModel: null });
      setConfirmingDelete(null);
      setNote({
        kind: "info",
        message: (
          <Trans
            i18nKey={next ? "models.manager.deletedNewDefault" : "models.manager.deleted"}
            values={{ name: model.name, place, size: formatStorage(model.size), next }}
            components={mono}
          />
        ),
      });
      await inventory.reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setIsDeleting(false);
    }
  }

  async function unload(name: string) {
    const memory = loaded.find((l) => l.name === name)?.memory ?? 0;
    setUnloading(name);
    setActionError(null);
    try {
      await unloadModel(config, name);
      await inventory.reloadLoaded();
      setNote({
        kind: "info",
        message: (
          <Trans
            i18nKey="models.manager.unloaded"
            values={{ name, place, size: formatStorage(memory) }}
            components={mono}
          />
        ),
      });
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setUnloading(null);
    }
  }

  if (inventory.status === "error") {
    return <OllamaUnavailable baseUrl={config.baseUrl} error={inventory.error} onRetry={inventory.reload} />;
  }
  if (inventory.status === "loading") {
    return (
      <p role="status" className="field-hint">
        {t("models.manager.loading", { address: config.baseUrl })}
      </p>
    );
  }

  const downloadCards = downloads.downloads.length > 0 && (
    <ul className="download-cards" aria-label={t("models.manager.downloads")}>
      {downloads.downloads.map((d) => (
        <ModelDownloadCard
          key={d.name}
          download={d}
          place={place}
          onCancel={() => downloads.cancel(d.name)}
          onRetry={() => downloads.start(d.name)}
          onDismiss={() => downloads.dismiss(d.name)}
          onEditName={() => {
            downloads.dismiss(d.name);
            setFormValue(d.name);
          }}
        />
      ))}
    </ul>
  );

  const query = installed.length >= FILTER_FROM ? filter.trim().toLowerCase() : "";
  const shown = (models: InstalledModel[]) => models.filter((m) => m.name.toLowerCase().includes(query));

  const rowOf = (model: InstalledModel) =>
    confirmingDelete === model.name ? (
      <ModelDeleteConfirm
        key={model.name}
        model={model}
        place={place}
        isDefault={model.name === defaultModelId}
        nextDefault={nextDefaultAfter(model.name)}
        isDeleting={isDeleting}
        onCancel={() => setConfirmingDelete(null)}
        onConfirm={() => remove(model)}
      />
    ) : (
      <InstalledModelRow
        key={model.name}
        model={model}
        loaded={loaded.find((l) => l.name === model.name)}
        isDefault={isDefaultOf(model)}
        isInUse={model.isEmbedding && model.name === embeddingInUse && !isDefaultOf(model)}
        isNew={model.name === recent}
        isUnloading={unloading === model.name}
        onToggleDefault={() => toggleDefault(model)}
        onUnload={() => unload(model.name)}
        onDelete={() => setConfirmingDelete(model.name)}
      />
    );

  // A group the filter leaves empty says so instead of disappearing
  const listOf = (models: InstalledModel[], noMatch: string) => {
    const rows = shown(models);
    return rows.length > 0 ? (
      <ul className="installed-models">{rows.map(rowOf)}</ul>
    ) : (
      <p className="installed-models-none">{noMatch}</p>
    );
  };

  function showDownloads() {
    downloadTitleRef.current?.scrollIntoView({ block: "start" });
    downloadTitleRef.current?.focus();
  }

  const isEmpty = installed.length === 0;
  const downloadSection = (
    <section className="model-section" aria-labelledby="download-model-title">
      <h4 id="download-model-title" ref={downloadTitleRef} tabIndex={-1}>
        {isEmpty ? t("models.manager.firstModel") : t("models.manager.downloadModel")}
      </h4>
      <DownloadModelForm
        value={formValue}
        onChange={setFormValue}
        installed={installedNames}
        downloading={downloadingNames}
        onDownload={downloads.start}
      />
      <h5 className="suggested-title">{t("models.manager.suggested")}</h5>
      <SuggestedModelList
        installed={installedNames}
        downloading={downloadingNames}
        highlight={isEmpty ? FIRST_MODEL : undefined}
        onDownload={downloads.start}
      />
    </section>
  );

  return (
    <div className="model-manager">
      {actionError && <ErrorNotice title={actionError} />}

      {isEmpty ? (
        <section className="model-section">
          <div className="models-empty">
            <div className="models-empty-mark" aria-hidden="true">
              <Cpu size={26} strokeWidth={1.6} />
            </div>
            <strong>{t("models.manager.emptyTitle")}</strong>
            <p>
              <Trans
                i18nKey="models.manager.emptyBody"
                values={{ name: FIRST_MODEL }}
                components={{ name: <span className="mono" /> }}
              />
            </p>
          </div>
          {downloadCards}
        </section>
      ) : (
        <section className="model-section" aria-labelledby="installed-models-title">
          <div className="model-section-header">
            <h4 id="installed-models-title">{t("models.manager.installed")}</h4>
            <span className="model-section-total">
              {t("models.manager.onDisk", { size: formatStorage(totalSize) })} ·{" "}
              {t("common.models", { count: installed.length })}
            </span>
            <button
              type="button"
              className="icon-button small"
              aria-label={t("models.manager.refreshLabel")}
              title={t("models.manager.refresh")}
              onClick={inventory.reload}
            >
              <RotateCw size={15} strokeWidth={2} />
            </button>
          </div>
          {note && (
            <div className={`model-note ${note.kind}`} role="status">
              <span className="model-note-text">{note.message}</span>
              {note.makeDefault && note.makeDefault !== defaultModelId && canChat(note.makeDefault) && (
                <button
                  type="button"
                  className="outline-button small"
                  onClick={() => note.makeDefault && onDefaultModelChange(note.makeDefault)}
                >
                  {t("models.useAsDefault")}
                </button>
              )}
              <button
                type="button"
                className="icon-button small"
                aria-label={t("models.manager.closeNote")}
                onClick={() => setNote(null)}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          )}
          {downloadCards}
          {installed.length >= FILTER_FROM && (
            <label className="installed-filter">
              <Search size={15} strokeWidth={2} aria-hidden="true" />
              <span className="visually-hidden">{t("models.manager.filterLabel")}</span>
              <input
                type="search"
                value={filter}
                placeholder={t("models.manager.filterPlaceholder")}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
          )}
          <InstalledModelGroup
            id="chat-models-title"
            icon={MessageSquare}
            kind="chat"
            title={t("models.manager.chatGroup")}
            count={shown(chatModels).length}
            description={chatModels.length > 0 ? t("models.manager.chatGroupHint") : undefined}
          >
            {chatModels.length === 0 ? (
              <ModelGroupEmpty
                icon={MessageSquare}
                kind="chat"
                title={t("models.manager.noChatTitle")}
                action={
                  <button type="button" className="outline-button small" onClick={showDownloads}>
                    {t("models.manager.seeChatModels")}
                  </button>
                }
              >
                {t("models.manager.noChatBody")}
              </ModelGroupEmpty>
            ) : (
              listOf(chatModels, t("models.manager.noChatMatch"))
            )}
          </InstalledModelGroup>
          <InstalledModelGroup
            id="search-models-title"
            icon={FolderSearch}
            kind="embedding"
            title={t("models.manager.searchGroup")}
            count={shown(embeddingModels).length}
            description={t("models.manager.searchGroupHint")}
          >
            {embeddingModels.length === 0 ? (
              <ModelGroupEmpty
                icon={FolderSearch}
                kind="embedding"
                title={t("models.manager.noSearchTitle")}
                action={
                  <button
                    type="button"
                    className="outline-button small embedding"
                    disabled={downloadingNames.has(RECOMMENDED_EMBEDDING_MODEL.name)}
                    onClick={() => downloads.start(RECOMMENDED_EMBEDDING_MODEL.name)}
                  >
                    <Download size={15} strokeWidth={2} />
                    {downloadingNames.has(RECOMMENDED_EMBEDDING_MODEL.name)
                      ? t("models.manager.downloadingShort")
                      : t("models.manager.downloadNamed", { name: RECOMMENDED_EMBEDDING_MODEL.name })}
                  </button>
                }
              >
                <Trans
                  i18nKey="models.manager.noSearchBody"
                  values={{
                    name: RECOMMENDED_EMBEDDING_MODEL.name,
                    size: formatStorage(RECOMMENDED_EMBEDDING_MODEL.size),
                  }}
                  components={{ name: <span className="mono" /> }}
                />
              </ModelGroupEmpty>
            ) : (
              <>
                {embeddingInUse && (
                  <EmbeddingStatus
                    inUse={embeddingInUse}
                    isChosen={embeddingInUse === embeddingDefault}
                    isOnlyOne={embeddingModels.length === 1}
                    onLetNyraChoose={() => updatePreferences({ embeddingModel: null })}
                  />
                )}
                {listOf(embeddingModels, t("models.manager.noSearchMatch"))}
              </>
            )}
          </InstalledModelGroup>
        </section>
      )}

      {downloadSection}
    </div>
  );
}
