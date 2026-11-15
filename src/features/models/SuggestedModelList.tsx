import { Brain, CircleCheck, Code, Download, Eye, Globe, Layers, type LucideIcon, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatStorage } from "@/shared/lib/format";
import { SUGGESTED_MODELS, type SuggestedModel } from "./ollamaCatalog";

type Props = {
  installed: ReadonlySet<string>;
  downloading: ReadonlySet<string>;
  // Marked "Para empezar" when nothing is installed yet
  highlight?: string;
  onDownload: (name: string) => void;
};

const ICONS: Record<SuggestedModel["kind"], LucideIcon> = {
  fast: Zap,
  balanced: Globe,
  vision: Eye,
  code: Code,
  reasoning: Brain,
  capable: Layers,
};

// The size is visible before clicking, so a click downloads straight away
export function SuggestedModelList({ installed, downloading, highlight, onDownload }: Props) {
  const { t } = useTranslation();
  return (
    <ul className="suggested-models">
      {SUGGESTED_MODELS.map((model) => {
        const isInstalled = installed.has(model.name);
        const isDownloading = downloading.has(model.name);
        const isUnavailable = isInstalled || isDownloading;
        const Icon = isInstalled ? CircleCheck : ICONS[model.kind];
        const purpose = t(`models.suggested.purposes.${model.kind}`);
        return (
          <li key={model.name}>
            <button
              type="button"
              className={`suggested-model ${model.name === highlight ? "highlight" : ""} ${isInstalled ? "installed" : ""}`}
              aria-disabled={isUnavailable}
              aria-label={
                isInstalled
                  ? t("models.suggested.installedLabel", { name: model.name })
                  : isDownloading
                    ? t("models.suggested.downloadingLabel", { name: model.name })
                    : t("models.suggested.downloadLabel", { name: model.name, size: formatStorage(model.size), purpose })
              }
              onClick={() => !isUnavailable && onDownload(model.name)}
            >
              <span className="suggested-model-icon">
                <Icon size={16} strokeWidth={2} />
              </span>
              <span className="suggested-model-text">
                <span className="mono suggested-model-name">{model.name}</span>
                <span className="suggested-model-purpose">{purpose}</span>
              </span>
              {isInstalled ? (
                <span className="model-pill ok">{t("models.suggested.installed")}</span>
              ) : isDownloading ? (
                <span className="model-pill">{t("models.suggested.downloading")}</span>
              ) : (
                <>
                  {model.name === highlight && <span className="model-pill default">{t("models.suggested.toStart")}</span>}
                  <span className="suggested-model-size">{formatStorage(model.size)}</span>
                  {model.name !== highlight && <Download size={15} strokeWidth={2} className="suggested-model-arrow" />}
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
