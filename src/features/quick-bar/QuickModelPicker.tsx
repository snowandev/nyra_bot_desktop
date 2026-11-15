import { Check, Sparkles } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { groupByProvider } from "@/features/models/modelGroups";
import { getProvider } from "@/providers";
import { contextSize } from "@/shared/lib/format";
import type { Model } from "@/shared/types";

type Props = {
  models: Model[];
  selectedId: string;
  onChoose: (id: string) => void;
  onClose: () => void;
  // "Gestionar modelos": Nyra's Settings, in the main window
  onManage: () => void;
  // «Automático», first, where there are two models to choose between: what it uses, and whether it is on
  auto?: { description: string; isOn: boolean; onChoose: () => void };
};

// The option before the models, for «Automático»
const AUTO = -1;

// Choosing the model inside the bar's own window, which grows upwards for it like the chat
export function QuickModelPicker({ models, selectedId, onChoose, onClose, onManage, auto }: Props) {
  const { t } = useTranslation();
  const groups = groupByProvider(models);
  const ordered = groups.flatMap((group) => group.models);
  const first = auto ? AUTO : 0;
  const [active, setActive] = useState(() =>
    auto?.isOn ? AUTO : Math.max(0, ordered.findIndex((m) => m.id === selectedId)),
  );
  // With «Automático» on, no model is the one chosen
  const chosenId = auto?.isOn ? null : selectedId;
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => list.current?.focus(), []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const count = ordered.length - first;
      setActive((current) => ((current - first + step + count) % count) + first);
    } else if ((event.key === "Enter" || event.key === " ") && active === AUTO && auto) {
      event.preventDefault();
      auto.onChoose();
    } else if ((event.key === "Enter" || event.key === " ") && ordered[active]) {
      event.preventDefault();
      onChoose(ordered[active].id);
    } else if (event.key === "Escape") {
      // Back to the box, without hiding the bar
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div className="quick-picker">
      <div
        ref={list}
        role="listbox"
        aria-label={t("quick.chooseModel")}
        tabIndex={0}
        aria-activedescendant={active === AUTO ? "quick-model-auto" : ordered[active] ? `quick-model-${active}` : undefined}
        onKeyDown={onKeyDown}
      >
        {auto && (
          <div
            id="quick-model-auto"
            role="option"
            aria-selected={auto.isOn}
            className={`quick-picker-option ${active === AUTO ? "active" : ""}`}
            onMouseEnter={() => setActive(AUTO)}
            onClick={auto.onChoose}
          >
            <span className="quick-picker-check">
              {auto.isOn && <Check size={15} strokeWidth={2.2} aria-hidden="true" />}
            </span>
            <span>
              <Sparkles size={13} strokeWidth={2.2} className="accent" aria-hidden="true" /> {t("models.menu.auto")}
            </span>
            <span className="quick-picker-meta">{auto.description}</span>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.providerId} role="group" aria-label={group.label}>
            <div className="quick-picker-group" aria-hidden="true">
              {group.label}
            </div>
            {group.models.map((model) => {
              const index = ordered.indexOf(model);
              const isLocal = !getProvider(model.providerId)?.requiresApiKey;
              return (
                <div
                  key={model.id}
                  id={`quick-model-${index}`}
                  role="option"
                  aria-selected={model.id === chosenId}
                  className={`quick-picker-option ${index === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onChoose(model.id)}
                >
                  <span className="quick-picker-check">
                    {model.id === chosenId && <Check size={15} strokeWidth={2.2} aria-hidden="true" />}
                  </span>
                  <span className={isLocal ? "mono" : undefined}>{model.name}</span>
                  {model.contextWindow && <span className="quick-picker-meta">{contextSize(model.contextWindow)}</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="quick-picker-footer">
        <span>{t("quick.pickerHelp")}</span>
        <button type="button" className="quick-link" onClick={onManage}>
          {t("quick.manageModels")}
        </button>
      </div>
    </div>
  );
}
