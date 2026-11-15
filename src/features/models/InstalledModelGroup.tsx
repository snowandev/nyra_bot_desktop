import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  id: string;
  icon: LucideIcon;
  // Chat models take the accent colour; embedding ones, the info colour
  kind: "chat" | "embedding";
  title: string;
  count: number;
  description?: string;
  children: ReactNode;
};

// One of the two groups of «Modelos instalados»: each has its own choice, so they never look like one list
export function InstalledModelGroup({ id, icon: Icon, kind, title, count, description, children }: Props) {
  const { t } = useTranslation();
  return (
    <section className="installed-group" aria-labelledby={id}>
      <h5 id={id} className="installed-group-title">
        <span className={`installed-group-icon ${kind}`} aria-hidden="true">
          <Icon size={14} strokeWidth={2.2} />
        </span>
        {title}
        <span className="installed-group-count" aria-label={t("common.models", { count })}>
          {count}
        </span>
      </h5>
      {description && <p className="installed-group-description">{description}</p>}
      {children}
    </section>
  );
}
