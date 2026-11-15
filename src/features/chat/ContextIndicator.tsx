import { Clock, Info, Ruler, TriangleAlert, Waves } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import type { ContextLimit, ContextState } from "@/features/chat/reply/context";
import { type ContextPart, dominantPart, scaledParts } from "@/features/chat/reply/contextBreakdown";
import { formatNumber, formatShare } from "@/shared/lib/format";
import { joinedList } from "./listFormat";

const RADIUS = 9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

type Props = {
  state: ContextState | null;
  // What the latest reply used when the limit isn't known (Ollama hasn't loaded the model, or the provider doesn't say)
  usedWithoutLimit?: number;
  // Who could tell the limit: Ollama does once it loads the model; other providers only through the size in Settings
  provider?: { name: string; loadsContextLength: boolean };
  // Where the limit comes from, also before any reply measured the conversation
  limit: ContextLimit | null;
  // The estimated parts, worked out only when the breakdown is shown, not on every frame of a reply
  parts: () => ContextPart[];
};

function nameOf(part: ContextPart, t: TFunction) {
  return part.kind === "folder"
    ? t("chat.context.parts.folder", { name: part.name ?? "" })
    : t(`chat.context.parts.${part.kind}`);
}

// How much of what is used, in words anyone reads at a glance
function shareWords(share: number, t: TFunction) {
  return t(
    share > 0.7
      ? "chat.context.share.almostAll"
      : share > 0.45
        ? "chat.context.share.almostHalf"
        : share > 0.3
          ? "chat.context.share.third"
          : "chat.context.share.largest",
  );
}

function suggestionFor(part: ContextPart, share: number, t: TFunction) {
  const values = { share: shareWords(share, t), name: part.kind === "files" ? (part.biggest ?? "") : "" };
  const key =
    part.kind === "folder"
      ? null
      : part.kind === "files" && part.biggest
        ? "chat.context.suggestion.biggestFile"
        : (`chat.context.suggestion.${part.kind}` as const);
  return key && <Trans i18nKey={key} values={values} components={{ b: <b /> }} />;
}

// Only for the model's maximum: the context Ollama loaded and the size set in Settings need no explaining
function sourceFor(limit: ContextLimit | null, t: TFunction) {
  return limit?.source === "maximum" ? t("chat.context.modelMaximum") : null;
}

// "la conversación, 2 archivos y la carpeta «x»"
function listed(parts: ContextPart[], t: TFunction) {
  const names = parts
    .filter((p) => p.kind !== "instructions")
    .map((p) =>
      p.kind === "folder"
        ? t("chat.context.listed.folder", { name: p.name ?? "" })
        : t(`chat.context.listed.${p.kind as "conversation" | "files" | "skills" | "memories"}`),
    );
  return joinedList(names);
}

// The ring next to the model and what fills the context, in a read-only tooltip on hover or focus
export function ContextIndicator({ state, usedWithoutLimit, provider, limit, parts }: Props) {
  const { t } = useTranslation();
  const waitsForLoad = provider?.loadsContextLength ?? true;
  const descriptionId = useId();
  const [isPeeking, setIsPeeking] = useState(false);
  const shown = isPeeking;
  const used = state?.used ?? usedWithoutLimit;
  const total = state?.limit;
  const level = state?.level ?? "normal";
  const estimated = shown ? parts() : [];
  const breakdown = shown && used !== undefined ? scaledParts(estimated, used) : [];
  const dominant = dominantPart(breakdown, state?.fraction ?? null);
  const share = (tokens: number) => (total ? formatShare(tokens / total) : "");

  const ringLabel = !used
    ? t("chat.context.ringNoData")
    : !state
      ? t("chat.context.ringUnknownLimit", { used: formatNumber(used) })
      : t(
          level === "critical"
            ? "chat.context.ringCritical"
            : level === "high"
              ? "chat.context.ringHigh"
              : "chat.context.ring",
          { percent: state.percentLabel },
        );
  const partValues = (part: ContextPart) => ({
    name: nameOf(part, t),
    tokens: formatNumber(part.tokens),
    share: share(part.tokens),
  });
  const spoken = breakdown
    .map((p) => t(total ? "chat.context.spokenPartShare" : "chat.context.spokenPart", partValues(p)))
    .join("; ");

  function row(part: ContextPart): ReactNode {
    const spokenRow = t(total ? "chat.context.rowPartShare" : "chat.context.rowPart", partValues(part));
    return (
      <li key={part.kind}>
        <div className={`context-part ${part === dominant ? "dominant" : ""}`}>
          <span className="visually-hidden">{spokenRow}</span>
          <span className={`context-swatch ${part.kind}`} aria-hidden="true" />
          <span className="context-part-name" aria-hidden="true">
            {nameOf(part, t)}
          </span>
          <span className="context-part-tokens" aria-hidden="true">
            {formatNumber(part.tokens)}
          </span>
          <span className="context-part-share" aria-hidden="true">
            {share(part.tokens)}
          </span>
        </div>
      </li>
    );
  }

  function content() {
    if (!used) {
      return (
        <>
          <span className="context-head">
            <span className="context-head-text">
              <b>{t("chat.context.noData")}</b>
              <small>{t("chat.context.noDataHint")}</small>
            </span>
          </span>
          <span className="context-stack empty" aria-hidden="true" />
          {estimated.length > 0 && (
            <span className="context-coming">
              {t("chat.context.coming", { parts: listed(estimated, t) })}
            </span>
          )}
          {sourceFor(limit, t) && (
            <span className="context-foot">
              <span>
                <Ruler size={12} strokeWidth={2} aria-hidden="true" />
                {sourceFor(limit, t)}
              </span>
            </span>
          )}
        </>
      );
    }
    const scale = total ?? used / 0.88;
    const free = total ? Math.max(0, total - used) : 0;
    const suggestion = dominant && suggestionFor(dominant, dominant.tokens / used, t);
    return (
      <>
        <span className="context-head">
          <span className="context-head-text">
            <b>
              {total
                ? t("chat.context.headWithTotal", {
                    used: formatNumber(used),
                    total: formatNumber(total),
                    percent: state?.percentLabel,
                  })
                : t("chat.context.headWithoutTotal", { used: formatNumber(used) })}
            </b>
            {!total ? (
              <small>{waitsForLoad ? t("chat.context.limitNotYetKnown") : t("chat.context.limitUnknown")}</small>
            ) : level === "critical" ? (
              <small>{t("chat.context.criticalHint")}</small>
            ) : level === "high" ? (
              <small>{t("chat.context.highHint", { free: formatNumber(free) })}</small>
            ) : null}
          </span>
          {level === "high" && <span className="context-level-tag high">{t("chat.context.high")}</span>}
          {level === "critical" && <span className="context-level-tag critical">{t("chat.context.critical")}</span>}
        </span>
        <span className={`context-stack ${total ? "" : "open-ended"}`} aria-hidden="true">
          {breakdown.map((p) => (
            <i key={p.kind} className={p.kind} style={{ width: `${(p.tokens / scale) * 100}%` }} />
          ))}
        </span>
        <span className="context-marks" aria-hidden="true">
          <span>0</span>
          <span>{total ? formatNumber(total) : t("chat.context.unknownLimitMark")}</span>
        </span>
        <span className="context-parts-label">
          <Waves size={12} strokeWidth={2} aria-hidden="true" />
          {t("chat.context.breakdown")}
        </span>
        <ul className="context-parts" aria-label={t("chat.context.breakdown")}>
          {breakdown.map(row)}
          {total && (
            <li>
              <div className="context-part free">
                <span className="visually-hidden">
                  {t("chat.context.freeSpoken", { tokens: formatNumber(free), share: share(free) })}
                </span>
                <span className="context-swatch free" aria-hidden="true" />
                <span className="context-part-name" aria-hidden="true">
                  {t("chat.context.free")}
                </span>
                <span className="context-part-tokens" aria-hidden="true">
                  {formatNumber(free)}
                </span>
                <span className="context-part-share" aria-hidden="true">
                  {share(free)}
                </span>
              </div>
            </li>
          )}
        </ul>
        {suggestion && (
          <span className={`context-suggestion ${level === "normal" ? "info" : level}`}>
            {level === "normal" ? (
              <Info size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
            )}
            <span>{suggestion}</span>
          </span>
        )}
        <span className="context-foot">
          <span>
            <Info size={12} strokeWidth={2} aria-hidden="true" />
            {total
              ? t("chat.context.footTotal")
              : waitsForLoad
                ? t("chat.context.footOllama")
                : t("chat.context.footProvider", { provider: provider?.name ?? t("chat.context.theProvider") })}
          </span>
          {!total ? (
            <span>
              <Clock size={12} strokeWidth={2} aria-hidden="true" />
              {waitsForLoad
                ? t("chat.context.autoSize")
                : t("chat.context.setSize", { provider: provider?.name ?? t("chat.context.yourProvider") })}
            </span>
          ) : (
            sourceFor(limit, t) && (
              <span>
                <Ruler size={12} strokeWidth={2} aria-hidden="true" />
                {sourceFor(limit, t)}
              </span>
            )
          )}
        </span>
      </>
    );
  }

  return (
    <div
      className={`context-indicator ${level}`}
      onPointerEnter={() => setIsPeeking(true)}
      onPointerLeave={() => setIsPeeking(false)}
    >
      <button
        type="button"
        className="context-ring-button"
        aria-label={ringLabel}
        aria-describedby={descriptionId}
        onFocus={() => setIsPeeking(true)}
        onBlur={() => setIsPeeking(false)}
      >
        <svg className="context-ring" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <circle className={`context-track ${state ? "" : "empty"}`} cx="12" cy="12" r={RADIUS} />
          {state && (
            <circle
              className="context-arc"
              cx="12"
              cy="12"
              r={RADIUS}
              strokeDasharray={`${state.fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            />
          )}
        </svg>
        {state && level !== "normal" && <span className="context-percent">{state.percentLabel}</span>}
      </button>
      <span className="visually-hidden" id={descriptionId}>
        {spoken ? t("chat.context.spokenBreakdown", { parts: spoken }) : ""}
      </span>

      {isPeeking && (
        <div className="context-tooltip" role="tooltip">
          {content()}
        </div>
      )}
    </div>
  );
}
