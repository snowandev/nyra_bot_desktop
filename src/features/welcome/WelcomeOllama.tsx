import { ChevronDown, ChevronUp, CircleCheck, Download, LoaderCircle, MemoryStick } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModelDownloadCard } from "@/features/models/ModelDownloadCard";
import { useModelDownloadsContext } from "@/features/models/modelDownloadsContext";
import {
  recommendedFor,
  SUGGESTED_MODELS,
  type SuggestedModel,
} from "@/features/models/ollamaCatalog";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";
import { ollama } from "@/providers/ollama";
import { type InstalledModel, listInstalledModels } from "@/providers/ollamaModels";
import { errorMessage } from "@/shared/lib/errors";
import { formatStorage } from "@/shared/lib/format";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import type { WelcomeResult } from "./welcomeSteps";

type Props = {
  memory: number | null;
  onResult: (local: WelcomeResult["local"]) => void;
};

type Found =
  | { kind: "checking" }
  | { kind: "remote"; address: string; state: "idle" | "checking" | "error"; error?: string }
  | { kind: "installed"; models: InstalledModel[] }
  | { kind: "empty" };

// The alternatives to the recommendation, by what people look for
const ALTERNATIVES: SuggestedModel["kind"][] = ["fast", "vision", "code"];

// Models on this computer: finds Ollama (or one on another computer), shows what it has, or recommends a model for
// this computer's memory and downloads it. Never holds the user back: the download goes on after the welcome.
export function WelcomeOllama({ memory, onResult }: Props) {
  const { t } = useTranslation();
  const settings = useProviderSettingsContext();
  const downloads = useModelDownloadsContext();
  const [found, setFound] = useState<Found>({ kind: "checking" });
  const [showOthers, setShowOthers] = useState(false);
  const recommended = recommendedFor(memory);
  const [chosen, setChosen] = useState(recommended.name);
  // Read when it looks, so an address changed meanwhile counts
  const look = useStableCallback(async () => {
    try {
      const models = (await listInstalledModels(settings.optionsFor(ollama.id))).filter((m) => !m.isEmbedding);
      setFound(models.length > 0 ? { kind: "installed", models } : { kind: "empty" });
      return true;
    } catch {
      return false;
    }
  });
  // Not on this computer: straight to where it is, Nyra doesn't send anyone to install it
  const lookOrAsk = useStableCallback(
    () => void look().then((ok) => ok || setFound({ kind: "remote", address: "", state: "idle" })),
  );

  useEffect(() => {
    lookOrAsk();
  }, [lookOrAsk]);

  const download = downloads.downloads.find((d) => d.name === chosen);
  const finished = downloads.lastFinished?.name === chosen && !download;

  const downloaded = finished ? chosen : null;
  // The downloaded model becomes the default when there isn't one yet
  useEffect(() => {
    if (finished && !settings.defaultModelId) settings.changeDefaultModel(chosen);
  }, [finished, chosen, settings]);

  const downloading = download?.status === "active";
  useEffect(() => {
    if (found.kind === "installed") onResult({ state: "ready", model: settings.defaultModelId ?? found.models[0]?.name });
    else if (downloaded) onResult({ state: "ready", model: downloaded });
    else if (downloading) onResult({ state: "downloading", model: chosen });
    else onResult({ state: "none" });
  }, [found, downloaded, downloading, chosen, settings.defaultModelId, onResult]);

  async function connectRemote(address: string) {
    setFound({ kind: "remote", address, state: "checking" });
    const candidate = { ...settings.optionsFor(ollama.id), baseUrl: address.trim() };
    try {
      const models = (await listInstalledModels(candidate)).filter((m) => !m.isEmbedding);
      settings.changeOptions(ollama.id, { baseUrl: candidate.baseUrl });
      setFound(models.length > 0 ? { kind: "installed", models } : { kind: "empty" });
    } catch (e) {
      setFound({ kind: "remote", address, state: "error", error: errorMessage(e) });
    }
  }

  const options = [
    { name: recommended.name, size: recommended.size, label: t("welcome.ollama.recommended") },
    ...ALTERNATIVES.flatMap((kind) => {
      const model = SUGGESTED_MODELS.find((m) => m.kind === kind && m.name !== recommended.name);
      return model ? [{ name: model.name, size: model.size, label: t(`models.suggested.purposes.${kind}`) }] : [];
    }),
  ];
  const size = options.find((o) => o.name === chosen)?.size ?? recommended.size;

  let body;
  if (found.kind === "checking") {
    body = (
      <div className="welcome-box" role="status">
        <span className="welcome-box-icon">
          <LoaderCircle size={20} strokeWidth={2} className="spin" aria-hidden="true" />
        </span>
        <div>
          <b>{t("welcome.ollama.checking")}</b>
          <p>{t("welcome.ollama.checkingHint")}</p>
        </div>
      </div>
    );
  } else if (found.kind === "remote") {
    body = (
      <form
        className="welcome-field"
        onSubmit={(e) => {
          e.preventDefault();
          if (found.address.trim()) void connectRemote(found.address);
        }}
      >
        <label htmlFor="welcome-ollama-address">{t("welcome.ollama.address")}</label>
        <div className={`welcome-input ${found.state === "error" ? "error" : ""}`}>
          <input
            id="welcome-ollama-address"
            value={found.address}
            placeholder={t("welcome.ollama.addressExample")}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={found.state === "error"}
            onChange={(e) => setFound({ kind: "remote", address: e.target.value, state: "idle" })}
          />
          <button type="submit" className="outline-button small" disabled={!found.address.trim()}>
            {t("welcome.ollama.connect")}
          </button>
        </div>
        <span className="welcome-hint">{t("welcome.ollama.addressHint")}</span>
        {found.state === "checking" && (
          <span className="welcome-status" role="status">
            <LoaderCircle size={15} strokeWidth={2} className="spin" aria-hidden="true" />
            {t("welcome.ollama.connecting")}
          </span>
        )}
        {found.state === "error" && (
          <span className="welcome-status error" role="alert">
            {t("welcome.ollama.noAnswer")}
          </span>
        )}
        <button
          type="button"
          className="welcome-link"
          onClick={() => {
            setFound({ kind: "checking" });
            lookOrAsk();
          }}
        >
          {t("welcome.ollama.lookHere")}
        </button>
      </form>
    );
  } else if (found.kind === "installed") {
    body = (
      <>
        <div className="welcome-box ok">
          <span className="welcome-box-icon">
            <CircleCheck size={20} strokeWidth={2} aria-hidden="true" />
          </span>
          <div>
            <b>{t("welcome.ollama.haveModels", { count: found.models.length })}</b>
            <p>{t("welcome.ollama.haveModelsHint")}</p>
          </div>
        </div>
        <ul className="welcome-models">
          {found.models.slice(0, 5).map((m) => (
            <li key={m.name}>
              <span className="mono">{m.name}</span>
              <span>{formatStorage(m.size)}</span>
            </li>
          ))}
        </ul>
      </>
    );
  } else if (downloaded) {
    body = (
      <div className="welcome-box ok" role="status">
        <span className="welcome-box-icon">
          <CircleCheck size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <div>
          <b>{t("welcome.ollama.downloaded", { name: downloaded })}</b>
          <p>{t("welcome.ollama.downloadedHint")}</p>
        </div>
      </div>
    );
  } else if (download) {
    body = (
      <>
        <ModelDownloadCard
          download={download}
          place={t("welcome.ollama.here")}
          onCancel={() => downloads.cancel(download.name)}
          onRetry={() => void downloads.start(download.name)}
          onDismiss={() => downloads.dismiss(download.name)}
          onEditName={() => {
            downloads.dismiss(download.name);
            setShowOthers(true);
          }}
        />
        {downloading && <p className="welcome-note strong">{t("welcome.ollama.keepGoing")}</p>}
      </>
    );
  } else {
    body = (
      <>
        <div className="welcome-recommended">
          <span className="welcome-why">
            <MemoryStick size={15} strokeWidth={2} aria-hidden="true" />
            {memory
              ? t("welcome.ollama.forMemory", {
                  memory: Math.round(memory / 1024 ** 3),
                  name: recommended.name,
                  why: t(`welcome.ollama.why.${recommended.why}`),
                })
              : t("welcome.ollama.forUnknown", { name: recommended.name, why: t(`welcome.ollama.why.${recommended.why}`) })}
          </span>
          <div className="welcome-model-line">
            <span className="mono welcome-model-name">{chosen}</span>
            {chosen === recommended.name && <span className="pill accent">{t("welcome.ollama.recommended")}</span>}
            <span className="welcome-model-size">{formatStorage(size)}</span>
            <button type="button" className="primary-button small" onClick={() => void downloads.start(chosen)}>
              <Download size={15} strokeWidth={2} aria-hidden="true" />
              {t("welcome.ollama.downloadModel")}
            </button>
          </div>
        </div>
        <button type="button" className="welcome-link" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)}>
          {showOthers ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          {t("welcome.ollama.others")}
        </button>
        {showOthers && (
          <div className="welcome-others" role="radiogroup" aria-label={t("welcome.ollama.others")}>
            {options.map((o) => (
              <button
                key={o.name}
                type="button"
                role="radio"
                aria-checked={chosen === o.name}
                className={`welcome-other ${chosen === o.name ? "selected" : ""}`}
                onClick={() => setChosen(o.name)}
              >
                <b>{o.label}</b>
                <span className="mono">{o.name}</span>
                <small>{formatStorage(o.size)}</small>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <h1 className="welcome-title" tabIndex={-1}>
        {t("welcome.ollama.title")}
      </h1>
      <p className="welcome-lead">{t("welcome.ollama.lead")}</p>
      {body}
    </>
  );
}
