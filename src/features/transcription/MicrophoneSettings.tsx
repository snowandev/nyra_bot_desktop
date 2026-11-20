import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import type { Microphone } from "@/shared/storage/settings";
import { type AudioInput, audioInputs } from "./microphoneStorage";

type Props = {
  microphone: Microphone | null;
  onChange: (microphone: Microphone | null) => void;
};

// The microphone dictation and meeting recordings use: the system's, or one the user picks. One picked and unplugged
// stays listed, so it's clear the system's is used meanwhile.
export function MicrophoneSettings({ microphone, onChange }: Props) {
  const { t } = useTranslation();
  const [inputs, setInputs] = useState<AudioInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    audioInputs()
      .then((found) => current && setInputs(found))
      .catch((e: unknown) => current && setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, []);

  const isMissing = !!microphone && !!inputs && !inputs.some((input) => input.id === microphone.id);
  const options: { id: string | null; name: string; hint?: string }[] = [
    { id: null, name: t("microphone.system"), hint: t("microphone.systemHint") },
    ...(inputs ?? []).map((input) => ({ id: input.id, name: input.name })),
    ...(isMissing ? [{ id: microphone.id, name: microphone.name, hint: t("microphone.unplugged") }] : []),
  ];
  const chosen = microphone?.id ?? null;

  return (
    <div className="transcription-settings">
      <div className="transcription-models" role="radiogroup" aria-label={t("microphone.title")}>
        {options.map((option) => (
          <div key={option.id ?? "system"} className={`transcription-model ${chosen === option.id ? "selected" : ""}`}>
            <button
              type="button"
              role="radio"
              aria-checked={chosen === option.id}
              className="transcription-model-pick"
              onClick={() => onChange(option.id === null ? null : { id: option.id, name: option.name })}
            >
              <b>{option.name}</b>
              {option.hint && <span className="transcription-model-state">{option.hint}</span>}
            </button>
          </div>
        ))}
      </div>
      {error && (
        <p className="transcription-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
