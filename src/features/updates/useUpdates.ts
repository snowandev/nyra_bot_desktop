import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { platformName } from "@/shared/lib/platform";
import { loadOpenedVersion, saveOpenedVersion } from "@/shared/storage/settings";
import { compareVersions, type VersionNotes, versionsBetween } from "./changelog";
import { fetchChangelog, findUpdate, type InstallKind, installKind, restartNyra } from "./updateStorage";

// Where the update is: the notice and the window show the same step
export type UpdateStep =
  | { kind: "none" }
  | { kind: "available" }
  | { kind: "downloading"; done: number; total: number | null }
  | { kind: "ready" }
  // Already in place on disk (macOS and Linux): it takes over the next time Nyra opens
  | { kind: "onQuit" }
  | { kind: "failed"; percent: number | null }
  // Just updated: the notice confirms it and offers the notes
  | { kind: "updated" };

// What "Buscar ahora" in Settings found
export type CheckResult = "checking" | "latest" | "available" | "failed";

// Windows installers close the app to install, so there is no "when I quit" there: it installs on restarting
export const canInstallOnQuit = platformName !== "windows";

export const percentOf = (step: Extract<UpdateStep, { kind: "downloading" }>) =>
  step.total ? Math.min(100, Math.round((step.done / step.total) * 100)) : null;

// Checks when Nyra opens (when the user allows it), and carries a found update through download and install
export function useUpdates(checkOnOpen: boolean) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [step, setStep] = useState<UpdateStep>({ kind: "none" });
  const [current, setCurrent] = useState<string | null>(null);
  const [notes, setNotes] = useState<VersionNotes[]>([]);
  const [kind, setKind] = useState<InstallKind>("selfUpdating");
  // "Más tarde": the notice goes until Nyra opens again, with a dot on Settings meanwhile
  const [isHidden, setIsHidden] = useState(false);
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null);
  // A cancelled download keeps arriving: only the latest one counts
  const download = useRef(0);
  const checkOnOpenAtStart = useRef(checkOnOpen);

  // The notes of what changed from one version to another; none when the release has no changelog
  async function notesBetween(from: string, to: string) {
    const changelog = await fetchChangelog().catch(() => null);
    return changelog ? versionsBetween(changelog, from, to) : [];
  }

  // Null when there is nothing newer; throws when it couldn't ask
  const find = useStableCallback(async (installed: string) => {
    const found = await findUpdate();
    if (!found) return null;
    setUpdate(found);
    setNotes(await notesBetween(installed, found.version));
    setStep((s) => (s.kind === "none" || s.kind === "updated" ? { kind: "available" } : s));
    return found;
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [version, installedAs] = await Promise.all([getVersion(), installKind().catch(() => "selfUpdating" as const)]);
      if (cancelled) return;
      setCurrent(version);
      setKind(installedAs);
      const before = loadOpenedVersion();
      saveOpenedVersion(version);
      if (before && compareVersions(version, before) > 0) {
        setStep({ kind: "updated" });
        const changed = await notesBetween(before, version);
        if (!cancelled) setNotes(changed);
        return;
      }
      // Without a connection, or with GitHub down, nothing is said: only a check by hand tells it
      if (checkOnOpenAtStart.current) await find(version).catch(() => null);
    })();
    return () => {
      cancelled = true;
    };
  }, [find]);

  async function checkNow() {
    if (!current) return;
    setCheckResult("checking");
    try {
      const found = await find(current);
      setCheckResult(found ? "available" : "latest");
      if (found) {
        setIsHidden(false);
        setIsNotesOpen(true);
      }
    } catch {
      setCheckResult("failed");
    }
  }

  async function startDownload() {
    if (!update) return;
    const attempt = ++download.current;
    let done = 0;
    let total: number | null = null;
    setStep({ kind: "downloading", done, total });
    try {
      await update.download((event) => {
        if (attempt !== download.current) return;
        if (event.event === "Started") total = event.data.contentLength ?? null;
        if (event.event === "Progress") done += event.data.chunkLength;
        setStep({ kind: "downloading", done, total });
      });
      if (attempt === download.current) setStep({ kind: "ready" });
    } catch {
      if (attempt === download.current) setStep({ kind: "failed", percent: total ? Math.round((done / total) * 100) : null });
    }
  }

  function cancelDownload() {
    download.current++;
    setStep({ kind: "available" });
  }

  // On Windows installing closes Nyra and its installer opens it again; elsewhere it installs, then restarts
  async function restart() {
    try {
      if (update && step.kind === "ready") await update.install();
      await restartNyra();
    } catch {
      setStep({ kind: "failed", percent: null });
    }
  }

  async function installOnQuit() {
    if (!update) return;
    try {
      await update.install();
      setStep({ kind: "onQuit" });
    } catch {
      setStep({ kind: "failed", percent: null });
    }
  }

  return {
    step,
    current,
    latest: update?.version ?? current,
    notes,
    kind,
    isHidden,
    isNotesOpen,
    checkResult,
    hide: () => setIsHidden(true),
    // After updating, the notice's job is done once seen
    dismissUpdated: () => setStep({ kind: "none" }),
    openNotes: () => setIsNotesOpen(true),
    closeNotes: () => setIsNotesOpen(false),
    checkNow,
    startDownload,
    cancelDownload,
    restart,
    installOnQuit,
  };
}
