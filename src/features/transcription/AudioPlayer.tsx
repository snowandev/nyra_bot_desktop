import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/shared/lib/errors";
import { extensionOf } from "@/shared/lib/paths";
import type { Attachment } from "@/shared/types";
import { playableAudio } from "./transcriptionStorage";

// Shown with a key per audio, so another one starts from nothing
type Props = { audio: Attachment };

export function AudioPlayer({ audio }: Props) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    playableAudio(audio.id, extensionOf(audio.name))
      .then((url) => isCurrent && setSrc(url))
      .catch((e: unknown) => isCurrent && setError(errorMessage(e)));
    return () => {
      isCurrent = false;
    };
  }, [audio.id, audio.name]);

  if (error) return <p role="alert">{error}</p>;
  if (!src) return null;
  return (
    // Each system's webview plays its own set of formats; the transcription doesn't depend on it
    <audio
      className="audio-player"
      controls
      preload="metadata"
      src={src}
      aria-label={t("transcription.viewer.play", { name: audio.name })}
      onError={() => setError(t("transcription.viewer.cannotPlay"))}
    />
  );
}
