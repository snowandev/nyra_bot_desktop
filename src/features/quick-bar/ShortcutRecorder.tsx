import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { platformName } from "@/shared/lib/platform";
import { DEFAULT_QUICK_SHORTCUT } from "@/shared/storage/settings";
import { acceleratorFromKeys, acceleratorLabel } from "./quickShortcut";

type Props = {
  shortcut: string;
  onChange: (shortcut: string) => void;
};

// The shortcut, and "Cambiar" to press a new one: the next combination with Cmd, Ctrl, Alt or Super is kept, and
// Esc leaves it as it was
export function ShortcutRecorder({ shortcut, onChange }: Props) {
  const { t } = useTranslation();
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    if (!isRecording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Nyra's own shortcuts don't run while a new one is pressed
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") return setIsRecording(false);
      const pressed = acceleratorFromKeys(event);
      if (!pressed) return;
      setIsRecording(false);
      onChange(pressed);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isRecording, onChange]);

  return (
    <div className="shortcut-recorder">
      <kbd className="shortcut-keys" aria-live="polite">
        {isRecording ? t("quick.pressKeys") : acceleratorLabel(shortcut, platformName)}
      </kbd>
      {isRecording ? (
        <button type="button" className="ghost-button" onClick={() => setIsRecording(false)}>
          {t("common.cancel")}
        </button>
      ) : (
        <>
          <button type="button" className="outline-button small" onClick={() => setIsRecording(true)}>
            {t("quick.change")}
          </button>
          {shortcut !== DEFAULT_QUICK_SHORTCUT && (
            <button type="button" className="ghost-button" onClick={() => onChange(DEFAULT_QUICK_SHORTCUT)}>
              {t("settings.appearance.reset")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
