import { Brain, Eye, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  // Each one only when the provider says so; unknown shows nothing
  readsImages?: boolean;
  readsFiles?: boolean;
  thinks?: boolean;
};

// Their names are in the catalog, under models.capabilities.<key>
const CAPABILITIES = [
  { key: "readsImages", Icon: Eye },
  { key: "readsFiles", Icon: FileText },
  { key: "thinks", Icon: Brain },
] as const;

// What a model can do, as icons; the name is in the tooltip and for screen readers
export function ModelCapabilityIcons(props: Props) {
  const { t } = useTranslation();
  const shown = CAPABILITIES.filter(({ key }) => props[key]);
  if (shown.length === 0) return null;

  return (
    <span className="model-capabilities">
      {shown.map(({ key, Icon }) => (
        <span
          key={key}
          className="model-capability"
          role="img"
          aria-label={t(`models.capabilities.${key}`)}
          title={t(`models.capabilities.${key}`)}
        >
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
        </span>
      ))}
    </span>
  );
}
