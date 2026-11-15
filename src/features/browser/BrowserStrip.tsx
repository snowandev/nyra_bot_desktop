import { AppWindow, Globe, Hand, LoaderCircle, ShieldQuestion, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { answerAsk, closeBrowser, giveBack, takeControl, useBrowserView } from "./browserSession";
import { placeOf } from "./browserSteps";
import { browserShow } from "./browserStorage";

type Props = {
  conversationId: string;
};

type StripState = "open" | "working" | "asking" | "yours";

const ICONS = { open: Globe, working: LoaderCircle, asking: ShieldQuestion, yours: Hand };

// The latest card of a reply in the browser, where its steps are; it may be out of sight
function showCard() {
  const cards = document.querySelectorAll<HTMLElement>("[data-browser-card]");
  cards[cards.length - 1]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// One line above the composer while the conversation has a browser, always at hand however far the chat is scrolled:
// open, Nyra using it, Nyra asking to open a site, or the user using it
export function BrowserStrip({ conversationId }: Props) {
  const { t } = useTranslation();
  const view = useBrowserView(conversationId);
  const [error, setError] = useState<string | null>(null);
  if (!view) return null;
  const state: StripState = view.userControl ? "yours" : view.asking ? "asking" : view.action ? "working" : "open";
  const place = state === "asking" ? view.asking?.site : view.url && placeOf(view.url);
  const asked = view.asking?.kind ?? "open";
  const Icon = ICONS[state];
  const shown = error ?? view.error;
  return (
    <div className="browser-strip-wrap">
      <div className={`status-strip browser-strip ${state}`} aria-label={t("browser.strip.label")} role="group">
        <Icon size={16} strokeWidth={2} className={state === "working" ? "spin" : undefined} aria-hidden="true" />
        <span className="browser-strip-text" role="status" title={view.action ?? undefined}>
          <b title={state === "asking" ? t(`browser.ask.hint.${asked}`, { site: place }) : undefined}>
            {state === "asking" ? t(`browser.strip.asking.${asked}`) : t(`browser.strip.${state}`)}
          </b>
          {place && (
            <span className="browser-strip-place" title={view.url}>
              {place}
            </span>
          )}
        </span>
        <span className="status-strip-actions">
          {state === "open" && (
            <>
              <button
                type="button"
                className="outline-button small"
                onClick={() => void browserShow(conversationId).catch((e) => setError(errorMessage(e)))}
              >
                <AppWindow size={14} strokeWidth={2} aria-hidden="true" />
                {t("browser.card.showWindow")}
              </button>
              <button
                type="button"
                className="ghost-button small"
                aria-label={t("browser.strip.closeLabel")}
                onClick={() => void closeBrowser(conversationId)}
              >
                <X size={14} strokeWidth={2} aria-hidden="true" />
                {t("browser.strip.close")}
              </button>
            </>
          )}
          {state === "working" && (
            <>
              <button type="button" className="ghost-button small" onClick={() => showCard()}>
                {t("browser.strip.steps")}
              </button>
              <button type="button" className="outline-button small" onClick={() => takeControl(conversationId)}>
                <Hand size={14} strokeWidth={2} aria-hidden="true" />
                {t("browser.control.take")}
              </button>
            </>
          )}
          {/* The only place it is asked: always in sight, however long the reply */}
          {state === "asking" && (
            <>
              <button type="button" className="outline-button small" onClick={() => answerAsk(conversationId, false)}>
                {t("browser.ask.deny")}
              </button>
              <button type="button" className="primary-button small" onClick={() => answerAsk(conversationId, true)}>
                {t("browser.ask.allow")}
              </button>
            </>
          )}
          {state === "yours" && (
            <button type="button" className="primary-button small" onClick={() => giveBack(conversationId)}>
              {t("browser.control.giveBack")}
            </button>
          )}
        </span>
      </div>
      {shown && (
        <p className="browser-strip-error" role="alert">
          {shown}
        </p>
      )}
    </div>
  );
}
