import { Eye, Highlighter, LoaderCircle, Monitor, MousePointer2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { answerGuide, answerLook, showMarks, stopActing, useScreenState } from "./screenSession";
import { screenActEnd, screenClear } from "./screenStorage";

type Props = {
  conversationId: string;
};

// One line above the composer: Nyra asking to look at the screen or use the mouse and keyboard, the only place it is
// asked; Nyra acting, to stop it; a guide going on, with the step the user is on; or its marks, to take them away
export function ScreenStrip({ conversationId }: Props) {
  const { t } = useTranslation();
  const state = useScreenState(conversationId);
  if (!state) return null;
  if (state.asking) {
    const toAct = state.asking === "act";
    const Icon = toAct ? MousePointer2 : Monitor;
    return (
      <div className="status-strip screen-strip asking" role="group" aria-label={t("screen.strip.label")}>
        <Icon size={16} strokeWidth={2} aria-hidden="true" />
        <span className="screen-strip-text" role="status">
          <b>{t(toAct ? "screen.strip.askingAct" : "screen.strip.asking")}</b>
          <span>{t(toAct ? "screen.strip.askingActHint" : "screen.strip.askingHint")}</span>
        </span>
        <span className="status-strip-actions">
          <button type="button" className="outline-button small" onClick={() => answerLook(conversationId, false)}>
            {t("screen.strip.deny")}
          </button>
          <button type="button" className="primary-button small" onClick={() => answerLook(conversationId, true)}>
            {t("screen.strip.allow")}
          </button>
        </span>
      </div>
    );
  }
  if (state.acting) {
    return (
      <div className="status-strip screen-strip guiding" role="group" aria-label={t("screen.strip.label")}>
        <MousePointer2 size={16} strokeWidth={2} aria-hidden="true" />
        <span className="screen-strip-text" role="status">
          <b>{t("screen.strip.acting")}</b>
          <span>{t("screen.strip.actingHint")}</span>
        </span>
        <span className="status-strip-actions">
          <button
            type="button"
            className="outline-button small"
            onClick={() => {
              stopActing(conversationId);
              void screenActEnd(conversationId, null).catch(() => {});
            }}
          >
            {t("screen.strip.stop")}
          </button>
        </span>
      </div>
    );
  }
  const { guide } = state;
  if (guide) {
    const Icon = guide.waiting ? Eye : LoaderCircle;
    return (
      <div className="status-strip screen-strip guiding" role="group" aria-label={t("screen.strip.label")}>
        <Icon size={16} strokeWidth={2} className={guide.waiting ? undefined : "spin"} aria-hidden="true" />
        <span className="screen-strip-text" role="status">
          <b>{t("screen.guide.step", { step: guide.step })}</b>
          <span title={guide.task}>{guide.waiting ? guide.task : t("screen.guide.checking")}</span>
        </span>
        <span className="status-strip-actions">
          {guide.waiting && (
            <button
              type="button"
              className="outline-button small"
              onClick={() => answerGuide(conversationId, "done")}
            >
              {t("screen.guide.done")}
            </button>
          )}
          <button type="button" className="outline-button small" onClick={() => answerGuide(conversationId, "end")}>
            {t("screen.guide.end")}
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="status-strip screen-strip" role="group" aria-label={t("screen.strip.label")}>
      <Highlighter size={16} strokeWidth={2} aria-hidden="true" />
      <span className="screen-strip-text" role="status">
        <b>{t("screen.strip.marks", { count: state.marks })}</b>
        <span>{t("screen.strip.marksHint")}</span>
      </span>
      <span className="status-strip-actions">
        <button
          type="button"
          className="outline-button small"
          onClick={() => {
            showMarks(conversationId, 0);
            void screenClear();
          }}
        >
          {t("screen.strip.clear")}
        </button>
      </span>
    </div>
  );
}
