import { Blocks, CircleCheck, Download, Plus, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { importFromClaudeDesktop, newImportCandidates } from "@/features/mcp/mcpStorage";
import { errorMessage } from "@/shared/lib/errors";

type Props = {
  imported: number;
  onImported: (count: number) => void;
  onAddServer: () => void;
  onNotNow: () => void;
};

// Optional: what MCP is, the servers Claude Desktop already has on this computer to bring in, or adding one
export function WelcomeMcp({ imported, onImported, onAddServer, onNotNow }: Props) {
  const { t } = useTranslation();
  // null while looking
  const [found, setFound] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    newImportCandidates()
      .then((fresh) => {
        const names = fresh.map((f) => f.server.name);
        setFound(names);
        setSelected(names);
      })
      .catch(() => setFound([]));
  }, []);

  async function bringIn() {
    try {
      onImported(await importFromClaudeDesktop(selected));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  let body;
  if (imported > 0) {
    body = (
      <div className="welcome-box ok" role="status">
        <span className="welcome-box-icon">
          <CircleCheck size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <b>{t("welcome.mcp.imported", { count: imported })}</b>
          <p>{t("welcome.mcp.importedHint")}</p>
        </div>
      </div>
    );
  } else if (found && found.length > 0) {
    body = (
      <>
        <b className="welcome-subtitle">{t("welcome.mcp.found", { count: found.length })}</b>
        <ul className="welcome-servers">
          {found.map((name) => (
            <li key={name}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(name)}
                  onChange={(e) =>
                    setSelected((list) => (e.target.checked ? [...list, name] : list.filter((n) => n !== name)))
                  }
                />
                <span className="mono">{name}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="welcome-pair">
          <button type="button" className="outline-button" disabled={selected.length === 0} onClick={() => void bringIn()}>
            <Download size={15} strokeWidth={2} aria-hidden="true" />
            {t("welcome.mcp.import")}
          </button>
          <button type="button" className="outline-button" onClick={onNotNow}>
            {t("welcome.mcp.notNow")}
          </button>
        </div>
      </>
    );
  } else if (found) {
    body = (
      <>
        <div className="welcome-pair">
          <button type="button" className="outline-button" onClick={onAddServer}>
            <Plus size={15} strokeWidth={2} aria-hidden="true" />
            {t("welcome.mcp.add")}
          </button>
          <button type="button" className="outline-button" onClick={onNotNow}>
            {t("welcome.mcp.notNow")}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="welcome-title" tabIndex={-1}>
        {t("welcome.mcp.title")} <span className="pill">{t("welcome.mcp.optional")}</span>
      </h1>
      <div className="welcome-explain">
        <Blocks size={18} strokeWidth={1.9} aria-hidden="true" />
        <span>{t("welcome.mcp.explain")}</span>
      </div>
      {body}
      {error && (
        <p className="welcome-status error" role="alert">
          {error}
        </p>
      )}
      <p className="welcome-note">
        <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />
        {t("welcome.mcp.trust")}
      </p>
    </>
  );
}
