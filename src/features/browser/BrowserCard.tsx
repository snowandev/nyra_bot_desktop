import {
  AppWindow,
  ChevronRight,
  CircleCheck,
  CircleMinus,
  CircleX,
  Globe,
  Hand,
  LoaderCircle,
  ShieldQuestion,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { imageSrc } from "@/features/attachments/attachments";
import { errorMessage } from "@/shared/lib/errors";
import type { Attachment, BrowserRecord } from "@/shared/types";
import { BrowserStepItem } from "./BrowserStepItem";
import { giveBack, takeControl, useBrowserView } from "./browserSession";
import { countsOf, endedInFailure, placeOf } from "./browserSteps";
import { browserShow } from "./browserStorage";

type Props = {
  record: BrowserRecord;
  conversationId: string;
  // The reply is still being written: the card follows the browser as it is now
  isLive: boolean;
  onOpenImage: (image: Attachment) => void;
};

type CardState = "working" | "asking" | "yours" | "done" | "stopped";

// While Nyra works, a long list shows its latest steps and the current one; the others fold behind a line
const FOLD_AFTER = 5;
const SHOWN_WHILE_WORKING = 4;

const STATE_ICONS = { working: LoaderCircle, asking: ShieldQuestion, yours: Hand, done: CircleCheck, stopped: CircleX };

// What a reply does in the browser, in the reply itself: the window's latest picture, where it is, each step with what
// the app checked and taking it over. Finished, it folds into one line, unless it failed. The question to open the
// browser is on the strip above the composer, always in sight.
export function BrowserCard({ record, conversationId, isLive, onOpenImage }: Props) {
  const { t } = useTranslation();
  const view = useBrowserView(conversationId);
  const live = isLive ? view : null;
  const { steps } = record;
  const state: CardState = live?.userControl
    ? "yours"
    : live?.asking
      ? "asking"
      : isLive
        ? "working"
        : endedInFailure(steps)
          ? "stopped"
          : "done";
  // null: as its state has it
  const [isExpanded, setIsExpanded] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const expanded = isExpanded ?? state === "stopped";
  const title = record.title || placeOf(record.url);
  const folded = isLive && !expanded && steps.length > FOLD_AFTER ? steps.length - SHOWN_WHILE_WORKING : 0;
  const StateIcon = STATE_ICONS[state];
  const counts = countsOf(steps);

  // Opened in the viewer like a file, though it isn't one of the conversation's
  const image: Attachment | null = record.thumbnail
    ? {
        id: `browser-${record.at}`,
        kind: "image",
        name: t("browser.card.thumbnailName", { title }),
        mimeType: "image/jpeg",
        data: record.thumbnail,
      }
    : null;

  return (
    <section className={`browser-card ${state}`} aria-label={t("browser.card.label")} data-browser-card>
      <div className="browser-card-head">
        {image && (
          <button
            type="button"
            className="browser-card-thumbnail"
            aria-label={t("browser.card.thumbnail", { title })}
            onClick={() => onOpenImage(image)}
          >
            <img src={imageSrc(image)} alt="" />
            {state === "working" && <span className="browser-card-live" aria-hidden="true" />}
            {state === "yours" && <span className="browser-card-you">{t("browser.card.you")}</span>}
          </button>
        )}
        <div className="browser-card-info">
          {title && <b className="browser-card-title">{title}</b>}
          {record.url && (
            <span className="browser-card-url" title={record.url}>
              <Globe size={13} strokeWidth={2} aria-hidden="true" />
              {placeOf(record.url)}
            </span>
          )}
          <span className="browser-card-state" role="status">
            <StateIcon
              size={14}
              strokeWidth={2.2}
              className={state === "working" ? "spin" : undefined}
              aria-hidden="true"
            />
            {t(`browser.card.${state}`)}
          </span>
        </div>
        <div className="browser-card-actions">
          {/* Only once it is open: while Nyra asks to open it there is no window yet */}
          {(view?.url || view?.opened) && (
            <button
              type="button"
              className="outline-button small"
              onClick={() => void browserShow(conversationId).catch((e) => setError(errorMessage(e)))}
            >
              <AppWindow size={14} strokeWidth={2} aria-hidden="true" />
              {t("browser.card.showWindow")}
            </button>
          )}
          {state === "working" && (
            <button type="button" className="outline-button small" onClick={() => takeControl(conversationId)}>
              <Hand size={14} strokeWidth={2} aria-hidden="true" />
              {t("browser.control.take")}
            </button>
          )}
          {state === "yours" && (
            <button type="button" className="primary-button small" onClick={() => giveBack(conversationId)}>
              {t("browser.control.giveBack")}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="browser-card-error" role="alert">
          {error}
        </p>
      )}

      {(isLive || expanded) && steps.length > 0 && (
        <div className="browser-card-steps">
          {folded > 0 && (
            <button type="button" className="browser-card-toggle" onClick={() => setIsExpanded(true)}>
              <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" />
              {t("browser.card.earlier", { count: folded })}
            </button>
          )}
          <ol aria-label={t("browser.card.stepsLabel")}>
            {steps.slice(folded).map((step, i) => (
              <BrowserStepItem key={folded + i} step={step} />
            ))}
          </ol>
        </div>
      )}
      {state === "yours" && <p className="browser-card-hint">{t("browser.card.yoursHint")}</p>}

      {!isLive && steps.length > 0 && (
        <div className="browser-card-summary">
          <span>{t("browser.card.steps", { count: steps.length })}</span>
          {counts.ok > 0 && (
            <span className="ok">
              <CircleCheck size={13} strokeWidth={2.2} aria-hidden="true" />
              {t("browser.card.ok", { count: counts.ok })}
            </span>
          )}
          {counts.noEffect > 0 && (
            <span className="noEffect">
              <CircleMinus size={13} strokeWidth={2.2} aria-hidden="true" />
              {t("browser.card.noEffect", { count: counts.noEffect })}
            </span>
          )}
          {counts.failed > 0 && (
            <span className="failed">
              <CircleX size={13} strokeWidth={2.2} aria-hidden="true" />
              {t("browser.card.failed", { count: counts.failed })}
            </span>
          )}
          <button
            type="button"
            className="browser-card-toggle"
            aria-expanded={expanded}
            onClick={() => setIsExpanded(!expanded)}
          >
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" className={expanded ? "open" : undefined} />
            {t(expanded ? "browser.card.hideSteps" : "browser.card.showSteps")}
          </button>
        </div>
      )}
    </section>
  );
}