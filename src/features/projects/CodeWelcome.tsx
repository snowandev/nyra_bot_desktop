import { CodeXml, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";

type Props = {
  onAddProject: () => void;
};

// The Código space before its first project
export function CodeWelcome({ onAddProject }: Props) {
  const { t } = useTranslation();
  return (
    <main className="main">
      <div className="code-welcome">
        <div className="code-welcome-column">
          <span className="code-welcome-icon" aria-hidden="true">
            <CodeXml size={26} strokeWidth={1.8} />
          </span>
          <h1>{t("projects.welcome.title")}</h1>
          <ul>
            <li>{t("projects.welcome.folders")}</li>
            <li>{t("projects.welcome.reads")}</li>
            <li>{t("projects.welcome.local")}</li>
          </ul>
          <button type="button" className="primary-button" onClick={onAddProject}>
            <FolderOpen size={17} strokeWidth={2} />
            {t("projects.welcome.choose")}
          </button>
        </div>
      </div>
    </main>
  );
}
