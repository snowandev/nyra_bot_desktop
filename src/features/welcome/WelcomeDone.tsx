import { Blocks, CircleCheck, Cloud, Cpu, FolderOpen, Globe, SquareTerminal, Bookmark, AppWindow } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { getProvider } from "@/providers";
import type { ModelPlaces, WelcomeResult } from "./welcomeSteps";

type Props = {
  places: ModelPlaces;
  result: WelcomeResult;
  onShowFeatures: () => void;
};

// What was set up, without promising what isn't there, and the way to everything else Nyra does
export function WelcomeDone({ places, result, onShowFeatures }: Props) {
  const { t } = useTranslation();
  const hasModel = result.local.state !== "none" || result.cloud.length > 0;
  const rows: { icon: ReactNode; title: string; detail: string; ready: boolean }[] = [];
  if (places.local) {
    rows.push({
      icon: <Cpu size={16} strokeWidth={1.9} />,
      title: t("welcome.where.local.title"),
      detail:
        result.local.state === "downloading"
          ? t("welcome.done.downloading", { name: result.local.model })
          : result.local.state === "ready"
            ? (result.local.model ?? t("welcome.done.ready"))
            : t("welcome.done.setUpLater"),
      ready: result.local.state === "ready",
    });
  }
  if (places.cloud) {
    rows.push({
      icon: <Cloud size={16} strokeWidth={1.9} />,
      title: t("welcome.where.cloud.title"),
      detail:
        result.cloud.length > 0
          ? result.cloud.map((c) => getProvider(c.providerId)?.name ?? c.providerId).join(", ")
          : t("welcome.done.noKey"),
      ready: result.cloud.length > 0,
    });
  }
  if (!places.local && !places.cloud) {
    rows.push({ icon: <Cpu size={16} strokeWidth={1.9} />, title: t("welcome.done.models"), detail: t("welcome.done.noneChosen"), ready: false });
  }
  rows.push({
    icon: <Blocks size={16} strokeWidth={1.9} />,
    title: t("welcome.mcp.title"),
    detail: result.mcpImported > 0 ? t("welcome.mcp.imported", { count: result.mcpImported }) : t("welcome.done.noMcp"),
    ready: result.mcpImported > 0,
  });

  return (
    <>
      <h1 className="welcome-title" tabIndex={-1}>
        {hasModel ? t("welcome.done.title") : t("welcome.done.almost")}
      </h1>
      <p className="welcome-lead">{hasModel ? t("welcome.done.lead") : t("welcome.done.almostLead")}</p>
      <ul className="welcome-summary">
        {rows.map((row) => (
          <li key={row.title}>
            <span className="welcome-summary-icon" aria-hidden="true">
              {row.icon}
            </span>
            <span className="welcome-summary-text">
              <b>{row.title}</b>
              <small>{row.detail}</small>
            </span>
            {row.ready ? (
              <span className="welcome-summary-state ok">
                <CircleCheck size={14} strokeWidth={2.2} aria-hidden="true" />
                {t("welcome.done.ready")}
              </span>
            ) : (
              <span className="welcome-summary-state">{t("welcome.done.notSet")}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="welcome-more">
        <div>
          <span className="welcome-more-icons" aria-hidden="true">
            <Globe size={15} strokeWidth={1.9} />
            <Bookmark size={15} strokeWidth={1.9} />
            <FolderOpen size={15} strokeWidth={1.9} />
            <SquareTerminal size={15} strokeWidth={1.9} />
            <AppWindow size={15} strokeWidth={1.9} />
          </span>
          <p>{t("welcome.done.more")}</p>
        </div>
        <button type="button" className="outline-button" onClick={onShowFeatures}>
          {t("welcome.done.showFeatures")}
        </button>
      </div>
    </>
  );
}
