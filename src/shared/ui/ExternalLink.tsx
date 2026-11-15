import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { openableUrl, openInBrowser } from "@/shared/lib/links";

type Props = {
  href: string | undefined;
  children: ReactNode;
  className?: string;
  // For links whose text alone doesn't say where they lead, like a citation number
  label?: string;
  // Shown on hover instead of the address
  title?: string;
};

// Links in replies come from the model, so they open in the system browser and show where they lead
export function ExternalLink({ href, children, className, label, title }: Props) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const url = openableUrl(href);
  if (!url) return <span className="unsafe-link">{children}</span>;

  return (
    <a
      href={url}
      className={[className, failed && "link-failed"].filter(Boolean).join(" ") || undefined}
      aria-label={label}
      title={failed ? t("ui.openFailed", { url }) : (title ?? url)}
      onClick={(e) => {
        e.preventDefault();
        setFailed(false);
        openInBrowser(url).catch(() => setFailed(true));
      }}
    >
      {children}
    </a>
  );
}
