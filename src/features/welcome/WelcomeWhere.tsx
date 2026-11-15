import { Check, Cloud, Cpu, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ModelPlaces } from "./welcomeSteps";

type Props = {
  places: ModelPlaces;
  onChange: (places: ModelPlaces) => void;
};

// On this computer, in the cloud, or both: check boxes, since both can be chosen
export function WelcomeWhere({ places, onChange }: Props) {
  const { t } = useTranslation();
  const card = (key: keyof ModelPlaces, Icon: LucideIcon, good: string[]) => (
    <label className={`welcome-place ${places[key] ? "selected" : ""}`}>
      <input type="checkbox" checked={places[key]} onChange={(e) => onChange({ ...places, [key]: e.target.checked })} />
      <span className="welcome-place-head">
        <span className="welcome-place-icon">
          <Icon size={20} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <span className="welcome-place-name">
          <b>{t(`welcome.where.${key}.title`)}</b>
          <small>{t(`welcome.where.${key}.with`)}</small>
        </span>
        <span className="welcome-check" aria-hidden="true">
          <Check size={14} strokeWidth={3} />
        </span>
      </span>
      <ul className="welcome-good">
        {good.map((line) => (
          <li key={line}>
            <Check size={13} strokeWidth={2.4} aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>
      <span className="welcome-needs">
        <Info size={14} strokeWidth={2} aria-hidden="true" />
        {t(`welcome.where.${key}.needs`)}
      </span>
    </label>
  );
  return (
    <>
      <h1 className="welcome-title" tabIndex={-1}>
        {t("welcome.where.title")}
      </h1>
      <p className="welcome-lead">{t("welcome.where.lead")}</p>
      <div className="welcome-places" role="group" aria-label={t("welcome.where.title")}>
        {card("local", Cpu, [t("welcome.where.local.private"), t("welcome.where.local.free"), t("welcome.where.local.offline")])}
        {card("cloud", Cloud, [t("welcome.where.cloud.capable"), t("welcome.where.cloud.noDownload")])}
      </div>
      <p className="welcome-note">
        <Info size={14} strokeWidth={2} aria-hidden="true" />
        {t("welcome.where.later")}
      </p>
    </>
  );
}
