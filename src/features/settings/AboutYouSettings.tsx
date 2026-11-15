import { useTranslation } from "react-i18next";
import type { Personalization } from "@/shared/storage/settings";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { TextField } from "./TextField";

type Props = {
  personalization: Personalization;
  onChange: (changes: Partial<Personalization>) => void;
};

export function AboutYouSettings({ personalization, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <SettingsPanel
      title={t("settings.personalization.about")}
      description={t("settings.personalization.aboutDescription")}
    >
      <TextField
        label={t("settings.personalization.nameLabel")}
        value={personalization.name}
        onChange={(name) => onChange({ name })}
        maxLength={60}
        placeholder={t("settings.personalization.namePlaceholder")}
      />
      <TextField
        label={t("settings.personalization.occupationLabel")}
        value={personalization.occupation}
        onChange={(occupation) => onChange({ occupation })}
        maxLength={100}
        placeholder={t("settings.personalization.occupationPlaceholder")}
      />
    </SettingsPanel>
  );
}
