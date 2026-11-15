import { Cloud, CreditCard, EyeOff, FileKey, KeyRound, Lock, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useId, useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useDialogPopover } from "@/shared/hooks/useDialogPopover";
import { useFitPlacement } from "@/shared/hooks/useFitPlacement";
import { labelsOf, maskSecret, type SensitiveKind, type SensitiveMatch } from "./sensitiveData";

type Props = {
  matches: SensitiveMatch[];
  placement: "up" | "down";
  // "Señalar": select that text in the box, ready to delete
  onSelectText?: (value: string) => void;
  // "Quitar": take the file out of the message
  onRemoveFile?: (id: string) => void;
  onOpenSettings?: () => void;
  // "Ocultar antes de enviar": every value in the message and its own files, keeping each setting's name
  onHideAll?: () => void;
};

const ICONS: Record<SensitiveKind, typeof KeyRound> = {
  key: KeyRound,
  password: Lock,
  "private-key": FileKey,
  card: CreditCard,
};

function placeOf(match: SensitiveMatch, isMultiline: boolean, t: TFunction) {
  if (match.place.type === "file") {
    return t("sensitive.place.file", { name: t("ui.quotedName", { name: match.place.name }) });
  }
  return isMultiline ? t("sensitive.place.messageLine", { line: match.place.line }) : t("sensitive.place.message");
}

// Only informative: it never stops the message from being sent
export function SensitiveDataIndicator(props: Props) {
  const { matches, placement, onSelectText, onRemoveFile, onOpenSettings, onHideAll } = props;
  const { isOpen, rootRef, close, toggle, triggerRef, closeRef, closeAndReturn, onDialogKeyDown } = useDialogPopover();
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const ids = { dialog: useId(), title: useId(), destination: useId() };
  const count = matches.length;
  const labels = labelsOf(matches);
  const isMultiline = matches.some((m) => m.place.type === "message" && m.place.line > 1);

  useFitPlacement(popoverRef, isOpen, placement);

  return (
    <div className="sensitive-data" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`sensitive-data-trigger ${count === 1 ? "single" : ""}`}
        aria-label={t("sensitive.trigger", { count, label: labels[0] })}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? ids.dialog : undefined}
        onClick={toggle}
      >
        <ShieldAlert size={17} strokeWidth={2.2} />
        {count > 1 && <span aria-hidden="true">{count}</span>}
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          id={ids.dialog}
          role="dialog"
          aria-labelledby={ids.title}
          aria-describedby={ids.destination}
          className="sensitive-data-popover"
          onKeyDown={onDialogKeyDown}
        >
          <div className="sensitive-data-header">
            <span className="sensitive-data-shield">
              <ShieldAlert size={16} strokeWidth={2.2} />
            </span>
            <h4 id={ids.title}>
              {t("sensitive.title")}
              <small>{t("sensitive.detections", { count })}</small>
            </h4>
            <button ref={closeRef} type="button" className="icon-button small" aria-label={t("sensitive.close")} onClick={closeAndReturn}>
              <X size={15} strokeWidth={2} />
            </button>
          </div>

          <ul className="sensitive-data-list" aria-label={t("sensitive.list")}>
            {matches.map((m) => {
              const Icon = ICONS[m.kind];
              const { place } = m;
              const key = `${m.label}-${m.value}-${place.type === "file" ? place.id : "message"}`;
              return (
                <li key={key}>
                  <span className="sensitive-data-icon">
                    <Icon size={15} strokeWidth={2} />
                  </span>
                  <span className="sensitive-data-text">
                    <strong>{m.label}</strong>
                    <span>{placeOf(m, isMultiline, t)}</span>
                    <span className="mono" aria-label={t("sensitive.masked")}>
                      {maskSecret(m)}
                    </span>
                  </span>
                  {place.type === "message" && onSelectText && (
                    <button
                      type="button"
                      className="sensitive-data-action"
                      aria-label={t("sensitive.pointLabel", { label: m.label })}
                      onClick={() => {
                        close();
                        onSelectText(m.value);
                      }}
                    >
                      {t("sensitive.point")}
                    </button>
                  )}
                  {place.type === "file" && onRemoveFile && (
                    <button
                      type="button"
                      className="sensitive-data-action"
                      aria-label={t("sensitive.removeLabel", { name: place.name })}
                      onClick={() => onRemoveFile(place.id)}
                    >
                      {t("sensitive.remove")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="sensitive-data-destination" id={ids.destination}>
            <Cloud size={16} strokeWidth={2} />
            <span>
              <Trans i18nKey="sensitive.destination" components={{ strong: <strong /> }} />
            </span>
          </div>
          {onHideAll ? (
            <div className="sensitive-data-hide">
              <button
                type="button"
                className="primary-button small"
                onClick={() => {
                  closeAndReturn();
                  onHideAll();
                }}
              >
                <EyeOff size={14} strokeWidth={2} />
                {t("sensitive.hideAll")}
              </button>
              <span>
                <Trans
                  i18nKey="sensitive.hideAllHint"
                  values={{ hidden: t("sensitive.hidden.value") }}
                  components={{ code: <span className="mono" /> }}
                />
              </span>
            </div>
          ) : (
            <p className="sensitive-data-help">
              {t("sensitive.help")}
              <span>{t("sensitive.helpLocal")}</span>
            </p>
          )}

          <div className="sensitive-data-footer">
            <span>
              <ShieldCheck size={13} strokeWidth={2} />
              {t("sensitive.checked")}
            </span>
            {onOpenSettings && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  close();
                  onOpenSettings();
                }}
              >
                {t("sensitive.disable")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
