import { CircleArrowUp, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsPanel } from "@/shared/ui/SettingsPanel";
import { Switch } from "@/shared/ui/Switch";
import { useUpdatesContext } from "./updatesContext";

type Props = {
  checkOnOpen: boolean;
  onCheckOnOpenChange: (enabled: boolean) => void;
};

// Configuración → General → Actualizaciones: checking on open, the installed version and checking by hand
export function UpdateSettings({ checkOnOpen, onCheckOnOpenChange }: Props) {
  const updates = useUpdatesContext();
  const { t } = useTranslation();
  const { checkResult: result, current, latest } = updates;
  const isChecking = result === "checking";

  return (
    <SettingsPanel title={t("updates.settings.title")} description={t("updates.settings.description")}>
      <div className="setting-row">
        <div className="setting-row-text">
          <span className="setting-row-title">{t("updates.settings.auto")}</span>
          <span className="setting-row-description">{t("updates.settings.autoHint")}</span>
        </div>
        <Switch checked={checkOnOpen} onChange={onCheckOnOpenChange} label={t("updates.settings.auto")} />
      </div>
      <div className="setting-row update-settings-version">
        <div className="setting-row-text">
          <span className="setting-row-title">{current && t("updates.settings.version", { version: current })}</span>
          {updates.kind === "package" && (
            <span className="setting-row-description">{t("updates.settings.package")}</span>
          )}
        </div>
        <button
          type="button"
          className="outline-button"
          aria-disabled={isChecking}
          onClick={() => !isChecking && void updates.checkNow()}
        >
          {t("updates.settings.checkNow")}
        </button>
        {result && (
          <div className={`update-check ${result}`} role={result === "failed" ? "alert" : "status"}>
            {result === "checking" && <LoaderCircle size={15} strokeWidth={2.2} className="spin" aria-hidden="true" />}
            {result === "latest" && <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" />}
            {result === "available" && <CircleArrowUp size={15} strokeWidth={2.2} aria-hidden="true" />}
            {result === "failed" && <CircleX size={15} strokeWidth={2.2} aria-hidden="true" />}
            <span>
              {result === "checking" && t("updates.settings.checking")}
              {result === "latest" && <strong>{t("updates.settings.latest")}</strong>}
              {result === "available" && latest && <strong>{t("updates.settings.available", { version: latest })}</strong>}
              {result === "failed" && (
                <>
                  <strong>{t("updates.settings.failed")}</strong> {t("updates.settings.failedHint")}
                </>
              )}
            </span>
            {result === "available" && (
              <button type="button" className="outline-button small" onClick={updates.openNotes}>
                {t("updates.notice.seeNotes")}
              </button>
            )}
          </div>
        )}
      </div>
    </SettingsPanel>
  );
}
