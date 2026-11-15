import { useTranslation } from "react-i18next";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { TextField } from "./TextField";

type Props = {
  instructions: string;
  onChange: (instructions: string) => void;
};

export function ResponseStyleSettings({ instructions, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <SettingsPanel
      title={t("settings.personalization.response")}
      description={t("settings.personalization.responseDescription")}
    >
      <TextField
        label={t("settings.personalization.responseLabel")}
        value={instructions}
        onChange={onChange}
        maxLength={1500}
        multiline
        placeholder={t("settings.personalization.responsePlaceholder")}
        hint={t("settings.personalization.responseHint")}
      />
    </SettingsPanel>
  );
}
