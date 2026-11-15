import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { i18n } from "@/shared/i18n/i18n";
import { errorMessage } from "@/shared/lib/errors";
import { PROVIDERS } from "@/providers";
import { forgetApiKey, loadApiKey, saveApiKey, savedApiKeys, type SecretStore, secretStore } from "./secretStorage";

// The keychain is written once typing pauses, not on every keystroke (on Linux a write can ask to unlock it)
const SAVE_DELAY_MS = 700;

// API keys in memory, plus the ones remembered on this computer. A saved key is read only once its provider is
// needed, since on macOS each keychain read may ask the user for permission.
export function useApiKeys() {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  // null until known, or when the Rust side isn't there (e.g. the UI in a plain browser)
  const [store, setStore] = useState<SecretStore | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef(new Map<string, number>());
  // Providers whose saved key was already asked for, so it is read once per run
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    Promise.all([secretStore(), savedApiKeys(PROVIDERS.map((p) => p.id))])
      .then(([found, withKey]) => {
        if (cancelled) return;
        setStore(found);
        setSaved(withKey);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(i18n.t("models.apiKeys.readAll", { error: errorMessage(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSaved = useCallback(
    (providerId: string) => {
      if (!saved.includes(providerId) || requested.current.has(providerId)) return;
      requested.current.add(providerId);
      loadApiKey(providerId)
        .then((key) => {
          // A key typed while it loaded wins over the saved one
          if (key) setApiKeys((current) => (current[providerId] ? current : { ...current, [providerId]: key }));
        })
        .catch((e: unknown) => setError(i18n.t("models.apiKeys.read", { error: errorMessage(e) })));
    },
    [saved],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const cancelPending = useCallback((providerId: string) => {
    window.clearTimeout(timers.current.get(providerId));
    timers.current.delete(providerId);
  }, []);

  const persist = useCallback(
    async (providerId: string, key: string) => {
      cancelPending(providerId);
      try {
        await saveApiKey(providerId, key);
        const isSaved = key.trim() !== "";
        setSaved((current) => [...current.filter((id) => id !== providerId), ...(isSaved ? [providerId] : [])]);
        setError(null);
      } catch (e) {
        setError(i18n.t("models.apiKeys.save", { error: errorMessage(e) }));
      }
    },
    [cancelPending],
  );

  const forgetSaved = useCallback(
    async (providerId: string) => {
      cancelPending(providerId);
      try {
        await forgetApiKey(providerId);
        setSaved((current) => current.filter((id) => id !== providerId));
        setError(null);
      } catch (e) {
        setError(i18n.t("models.apiKeys.delete", { error: errorMessage(e) }));
      }
    },
    [cancelPending],
  );

  const changeKey = useCallback(
    (providerId: string, key: string, remember: boolean) => {
      setApiKeys((keys) => ({ ...keys, [providerId]: key }));
      if (!remember || !store) return;
      cancelPending(providerId);
      timers.current.set(providerId, window.setTimeout(() => persist(providerId, key), SAVE_DELAY_MS));
    },
    [store, cancelPending, persist],
  );

  // Turning it off deletes the saved key at once, not just stops saving it
  const changeRemember = useCallback(
    (providerId: string, remember: boolean) => {
      if (remember) persist(providerId, apiKeys[providerId] ?? "");
      else forgetSaved(providerId);
    },
    [apiKeys, persist, forgetSaved],
  );

  // "Olvidar la clave": gone from this computer and from the field
  const forget = useCallback(
    (providerId: string) => {
      setApiKeys((keys) => ({ ...keys, [providerId]: "" }));
      forgetSaved(providerId);
    },
    [forgetSaved],
  );

  // The same object until something in it changes, so whoever reads it doesn't re-render for nothing
  return useMemo(
    () => ({ apiKeys, store, saved, error, loadSaved, changeKey, changeRemember, forget }),
    [apiKeys, store, saved, error, loadSaved, changeKey, changeRemember, forget],
  );
}
