import { useEffect, useRef, useState } from "react";
import { findSensitiveData, type SensitiveMatch } from "./sensitiveData";
import { getProvider } from "@/providers";
import type { Attachment } from "@/shared/types";
import { usePreferencesContext } from "@/features/settings/preferencesContext";
import { useProviderSettingsContext } from "@/features/models/providerSettingsContext";

// Waits for a pause in typing, so the indicator doesn't flicker halfway through pasting or typing a key
const CHECK_DELAY_MS = 300;

// What looks like a secret in the message being written, when it is about to go to a cloud provider
export function useSensitiveData(text: string, files: Attachment[]) {
  const { preferences } = usePreferencesContext();
  const { selectedModel } = useProviderSettingsContext();
  const provider = selectedModel && getProvider(selectedModel.providerId);
  // With a local server nothing leaves the computer, so there is nothing to point out
  const isOn = preferences.sensitiveDataWarning && !!provider?.requiresApiKey;
  const [found, setFound] = useState<SensitiveMatch[]>([]);
  // The file list is a new array on every render (and the chat renders every frame while a reply streams), so
  // the check depends on which files there are, not on the array
  const filesKey = files.map((f) => f.id).join("\0");
  const latestFiles = useRef(files);

  useEffect(() => {
    latestFiles.current = files;
  });

  useEffect(() => {
    if (!isOn) return;
    const timer = window.setTimeout(() => setFound(findSensitiveData(text, latestFiles.current)), CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isOn, text, filesKey]);

  // Showing up waits for the pause; going away doesn't: a match the user already deleted is dropped at once
  const fileIds = new Set(files.map((f) => f.id));
  const matches = isOn
    ? found.filter((m) => (m.place.type === "message" ? text.includes(m.value) : fileIds.has(m.place.id)))
    : [];

  return { matches, destination: provider?.name ?? "" };
}
