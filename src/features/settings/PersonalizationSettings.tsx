import { Bookmark, MessageSquareText, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useMemoriesContext } from "@/features/memory/memoriesContext";
import { usePreferencesContext } from "./preferencesContext";
import type { Personalization } from "@/shared/storage/settings";
import { AboutYouSettings } from "./AboutYouSettings";
import { MemorySettings } from "@/features/memory/MemorySettings";
import { ResponseStyleSettings } from "./ResponseStyleSettings";
import { SettingsOption } from "@/shared/ui/SettingsOption";

export type PersonalizationOption = "about" | "response" | "memory";

type Props = {
  initialOption?: PersonalizationOption;
  // For the conversation each memory came from
  conversationTitle: (id: string) => string | undefined;
  onOpenConversation: (id: string) => void;
  onShowFeatures: () => void;
};

function aboutStatus({ name, occupation }: Personalization, t: TFunction) {
  if (name.trim()) return name.trim();
  return occupation.trim() ? t("settings.personalization.filledIn") : t("settings.personalization.notFilledIn");
}

export function PersonalizationSettings(props: Props) {
  const { initialOption = "about", conversationTitle, onOpenConversation, onShowFeatures } = props;
  const { preferences, updatePreferences } = usePreferencesContext();
  const { t } = useTranslation();
  const { memories } = useMemoriesContext();
  const { personalization } = preferences;
  const [selected, setSelected] = useState<PersonalizationOption>(initialOption);
  const update = (changes: Partial<Personalization>) =>
    updatePreferences({ personalization: { ...personalization, ...changes } });

  return (
    <div className="settings-content">
      <section aria-label={t("settings.personalization.label")} className="settings-list">
        <div className="section-label">{t("common.options")}</div>
        <SettingsOption
          icon={<UserRound size={18} strokeWidth={1.8} />}
          name={t("settings.personalization.about")}
          status={<span className="settings-option-status">{aboutStatus(personalization, t)}</span>}
          selected={selected === "about"}
          onSelect={() => setSelected("about")}
        />
        <SettingsOption
          icon={<MessageSquareText size={18} strokeWidth={1.8} />}
          name={t("settings.personalization.response")}
          status={
            <span className="settings-option-status">
              {personalization.instructions.trim()
                ? t("settings.personalization.custom")
                : t("settings.personalization.default")}
            </span>
          }
          selected={selected === "response"}
          onSelect={() => setSelected("response")}
        />
        <SettingsOption
          icon={<Bookmark size={18} strokeWidth={1.8} />}
          name={t("settings.personalization.memory")}
          status={
            <span className="settings-option-status">
              <span className={`status-dot ${preferences.memory ? "loaded" : "idle"}`} />
              {preferences.memory
                ? t("common.memories", { count: memories.length })
                : t("settings.personalization.memoryOff")}
            </span>
          }
          selected={selected === "memory"}
          onSelect={() => setSelected("memory")}
        />
      </section>

      {selected === "about" && <AboutYouSettings personalization={personalization} onChange={update} />}
      {selected === "response" && (
        <ResponseStyleSettings
          instructions={personalization.instructions}
          onChange={(instructions) => update({ instructions })}
        />
      )}
      {selected === "memory" && (
        <MemorySettings
          conversationTitle={conversationTitle}
          onOpenConversation={onOpenConversation}
          onShowFeatures={onShowFeatures}
        />
      )}
    </div>
  );
}
