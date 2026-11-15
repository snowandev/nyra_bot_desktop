import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useModelDownloadsContext } from "./modelDownloadsContext";
import { overallProgress } from "./useModelDownloads";
import { usePopover } from "@/shared/hooks/usePopover";
import type { Model } from "@/shared/types";
import { BrandIcon } from "@/shared/ui/BrandIcon";
import { ModelMenu, type ModelPreference } from "./ModelMenu";
import { ProgressRing } from "./ProgressRing";
import { useProviderSettingsContext } from "./providerSettingsContext";

type Props = {
  models: Model[];
  selectedId: string;
  onSelect: (id: string) => void;
  placement: "up" | "down";
  onOpenSettings: () => void;
  preference?: ModelPreference;
  // «Automático» between the main model and the one for demanding tasks, in the chat
  withAuto?: boolean;
};

export function ModelSelector(props: Props) {
  const { models, selectedId, onSelect, placement, onOpenSettings, preference, withAuto = false } = props;
  const { isOpen, rootRef, close, toggle } = usePopover();
  const { t } = useTranslation();
  const selected = models.find((m) => m.id === selectedId);
  const { isAuto, selectAuto } = useProviderSettingsContext();
  const showsAuto = withAuto && isAuto;
  const progress = overallProgress(useModelDownloadsContext().downloads);
  const label = showsAuto ? t("models.menu.auto") : (selected?.name ?? t("models.menu.choose"));

  return (
    <div className="model-selector" ref={rootRef}>
      <button
        type="button"
        className="model-selector-trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={toggle}
        title={label}
      >
        <BrandIcon size={16} className="brand-mark" />
        <span className="model-selector-name">{label}</span>
        {progress.count > 0 && <ProgressRing percent={progress.percent} size={16} />}
        <ChevronDown size={14} strokeWidth={2} />
      </button>

      {isOpen && (
        <ModelMenu
          models={models}
          selectedId={selectedId}
          onAuto={
            withAuto
              ? () => {
                  selectAuto();
                  close();
                }
              : undefined
          }
          placement={placement}
          onSelect={(id) => {
            onSelect(id);
            close();
          }}
          onOpenSettings={() => {
            close();
            onOpenSettings();
          }}
          preference={
            preference && {
              ...preference,
              onPrefer:
                preference.onPrefer &&
                ((id) => {
                  close();
                  preference.onPrefer?.(id);
                }),
            }
          }
        />
      )}
    </div>
  );
}
