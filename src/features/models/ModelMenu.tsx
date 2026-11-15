import { Check, Cloud, History, Search, Server, Settings, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFitPlacement } from "@/shared/hooks/useFitPlacement";
import { useModelDownloadsContext } from "./modelDownloadsContext";
import { useProviderSettingsContext } from "./providerSettingsContext";
import { percentOf } from "./useModelDownloads";
import { groupByProvider, LONG_MENU, matchesQuery, menuModels, recentModels } from "./modelGroups";
import { getProvider } from "@/providers";
import { loadCollapsedModelGroups, saveCollapsedModelGroups } from "@/shared/storage/settings";
import type { Model } from "@/shared/types";
import { SidebarSection } from "@/shared/ui/SidebarSection";
import { ModelCapabilityIcons } from "./ModelCapabilityIcons";

// In a project of the Código space: the model its new conversations start with
export type ModelPreference = {
  projectName: string;
  modelId: string | null;
  // Missing where choosing a model already makes it the preferred one (the project's home)
  onPrefer?: (id: string) => void;
};

type Props = {
  models: Model[];
  selectedId: string;
  placement: "up" | "down";
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  preference?: ModelPreference;
  // The chat's menu offers «Automático» when there are two models to choose between; Settings' pickers don't
  onAuto?: () => void;
};

export function ModelMenu(props: Props) {
  const { models, selectedId, placement, onSelect, onOpenSettings, preference, onAuto } = props;
  const settings = useProviderSettingsContext();
  const { hiddenModelIds, recentModelIds, defaultModelId, demandingModelId } = settings;
  const canAuto = !!onAuto && !!defaultModelId && !!demandingModelId && defaultModelId !== demandingModelId;
  const isAuto = canAuto && settings.isAuto;
  const nameOf = (id: string | null) => models.find((m) => m.id === id)?.name ?? "";
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(loadCollapsedModelGroups);
  // Models still downloading show up too, so it's clear they'll be here soon
  const downloading = useModelDownloadsContext().downloads.filter((d) => d.status === "active");

  const visible = menuModels(models, hiddenModelIds, selectedId);
  const isLong = visible.length >= LONG_MENU;
  const matches = visible.filter((m) => matchesQuery(m, query));
  const groups = groupByProvider(matches);
  // Decided on all the models, so a search that leaves one provider still says which one it is
  const showProviders = groupByProvider(visible).length > 1;
  const recent = isLong && !query.trim() ? recentModels(visible, recentModelIds, defaultModelId) : [];

  useFitPlacement(menuRef, true, placement);
  // Without preventScroll, focusing could scroll the areas around the menu to show it
  useEffect(() => searchRef.current?.focus({ preventScroll: true }), []);

  // While searching every group is open, so a match is never hidden in a collapsed one
  const isOpen = (group: string) => !!query.trim() || !collapsed.includes(group);

  function toggle(group: string) {
    const next = collapsed.includes(group) ? collapsed.filter((g) => g !== group) : [...collapsed, group];
    setCollapsed(next);
    saveCollapsedModelGroups(next);
  }

  const groupIcon = (providerId: string) =>
    getProvider(providerId)?.requiresApiKey ? (
      <Cloud size={12} strokeWidth={2.2} className="accent" />
    ) : (
      <Server size={12} strokeWidth={2.2} className="accent" />
    );

  function option(m: Model, section: string) {
    const isSelected = !isAuto && m.id === selectedId;
    return (
      <button
        key={`${section}:${m.id}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        className={`model-option ${isSelected ? "selected" : ""}`}
        onClick={() => onSelect(m.id)}
      >
        <span className="model-option-text">
          <span className="model-option-name">
            {m.name}
            {m.id === preference?.modelId && <span className="model-option-tag">{t("models.menu.preferred")}</span>}
          </span>
          <span className="model-option-description">
            {m.description}
            <ModelCapabilityIcons readsImages={m.supportsImages} readsFiles={m.readsFiles} thinks={m.thinks} />
          </span>
        </span>
        <Check size={16} strokeWidth={2.2} className="model-option-check" />
      </button>
    );
  }

  return (
    <div ref={menuRef} className="model-menu">
      {isLong && (
        <label className="search-field model-menu-search">
          <Search size={15} strokeWidth={2} />
          <span className="visually-hidden">{t("models.menu.search")}</span>
          <input
            ref={searchRef}
            type="search"
            placeholder={t("models.menu.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) onSelect(matches[0].id);
            }}
          />
        </label>
      )}

      <div role="listbox" aria-label={t("models.menu.listLabel")} className="model-menu-list">
        {models.length === 0 && (
          <div className="model-menu-empty">
            <span>{t("models.menu.empty")}</span>
            <button type="button" className="link-button" onClick={onOpenSettings}>
              {t("models.menu.setUpProvider")}
            </button>
          </div>
        )}
        {canAuto && !query.trim() && (
          <button
            type="button"
            role="option"
            aria-selected={isAuto}
            className={`model-option ${isAuto ? "selected" : ""}`}
            onClick={onAuto}
          >
            <span className="model-option-text">
              <span className="model-option-name">
                <Sparkles size={13} strokeWidth={2.2} className="accent" aria-hidden="true" />
                {t("models.menu.auto")}
              </span>
              <span className="model-option-description">
                {t("models.menu.autoDescription", { main: nameOf(defaultModelId), demanding: nameOf(demandingModelId) })}
              </span>
            </span>
            <Check size={16} strokeWidth={2.2} className="model-option-check" />
          </button>
        )}
        {models.length > 0 && matches.length === 0 && (
          <div className="model-menu-empty">{t("models.menu.noMatch", { query: query.trim() })}</div>
        )}

        {recent.length > 0 && (
          <SidebarSection
            title={t("models.menu.recent")}
            icon={<History size={12} strokeWidth={2.2} className="accent" />}
            count={recent.length}
            isOpen={isOpen("recent")}
            onToggle={() => toggle("recent")}
          >
            {recent.map((m) => option(m, "recent"))}
          </SidebarSection>
        )}

        {showProviders
          ? groups.map((group) => (
              <SidebarSection
                key={group.providerId}
                title={group.label}
                icon={groupIcon(group.providerId)}
                count={group.models.length}
                isOpen={isOpen(group.providerId)}
                onToggle={() => toggle(group.providerId)}
              >
                {group.models.map((m) => option(m, group.providerId))}
              </SidebarSection>
            ))
          : groups.map((group) => (
              <div key={group.providerId} role="group" aria-labelledby="model-menu-single">
                <div id="model-menu-single" className="section-label">
                  {t("models.menu.model")}
                </div>
                {group.models.map((m) => option(m, group.providerId))}
              </div>
            ))}

        {downloading.length > 0 && (
          <div role="group" aria-labelledby="model-menu-downloading">
            <div id="model-menu-downloading" className="section-label">
              {t("models.menu.downloading")}
            </div>
            {downloading.map((d) => {
              const percent = percentOf(d) ?? 0;
              return (
                <div key={d.name} className="model-option downloading" role="option" aria-disabled="true" aria-selected="false">
                  <span className="model-option-download">
                    <span className="mono">{d.name}</span>
                    <span>{t("models.percent", { percent })}</span>
                  </span>
                  <span
                    className="download-bar thin"
                    role="progressbar"
                    aria-label={t("models.downloadCard.barLabel", { name: d.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {preference?.onPrefer && selectedId && selectedId !== preference.modelId && (
        <button type="button" className="model-menu-prefer" onClick={() => preference.onPrefer?.(selectedId)}>
          <Check size={14} strokeWidth={2} />
          <span>
            {t("models.menu.alwaysIn", { project: preference.projectName })}
            <span className="model-menu-prefer-hint">{t("models.menu.alwaysInHint")}</span>
          </span>
        </button>
      )}
      {models.length > 0 && (
        <button type="button" className="model-menu-manage" onClick={onOpenSettings}>
          <Settings size={14} strokeWidth={2} />
          {t("models.menu.manage")}
        </button>
      )}
    </div>
  );
}
