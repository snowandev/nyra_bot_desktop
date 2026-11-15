import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import {
  type PullErrorKind,
  type PullPhase,
  type PullProgress,
  pullErrorKind,
  pullModel,
} from "@/providers/ollamaModels";
import type { ProviderConfig } from "@/shared/types";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

export type ModelDownload = {
  name: string;
  status: "active" | "error" | "cancelled";
  phase: PullPhase;
  // Bytes
  completed: number;
  total: number;
  // Bytes per second, smoothed; null until there is enough to measure
  speed: number | null;
  errorKind?: PullErrorKind;
  error?: string;
};

type FinishedDownload = { name: string; size: number; at: number };

// 0–100; unknown (null) while Ollama hasn't said how big the model is
export const percentOf = (d: Pick<ModelDownload, "completed" | "total">) =>
  d.total > 0 ? Math.min(100, Math.floor((d.completed / d.total) * 100)) : null;

// All active downloads as one, for the indicators outside Settings
export function overallProgress(downloads: ModelDownload[]) {
  const active = downloads.filter((d) => d.status === "active");
  const completed = active.reduce((sum, d) => sum + d.completed, 0);
  const total = active.reduce((sum, d) => sum + d.total, 0);
  return { count: active.length, completed, total, percent: percentOf({ completed, total }) ?? 0 };
}

// Ollama reports progress many times a second; the screen doesn't need more than this
const REDRAW_MS = 250;
const SPEED_SAMPLE_MS = 1000;
// Weight of the newest speed sample: smooths the jumps between network chunks
const SPEED_SMOOTHING = 0.3;

type Options = {
  // Read when a download starts: it goes to the Ollama the settings point at at that moment
  configFor: () => ProviderConfig;
  onFinished: (download: FinishedDownload) => void;
};

// Downloads live at the app level, so they go on while Settings is closed
export function useModelDownloads({ configFor, onFinished }: Options) {
  const [downloads, setDownloads] = useState<ModelDownload[]>([]);
  const [lastFinished, setLastFinished] = useState<FinishedDownload | null>(null);
  const controllers = useRef(new Map<string, AbortController>());
  const finished = useStableCallback(onFinished);

  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);

  function update(name: string, change: Partial<ModelDownload>) {
    setDownloads((list) => list.map((d) => (d.name === name ? { ...d, ...change } : d)));
  }

  async function start(name: string) {
    if (controllers.current.has(name)) return;
    const controller = new AbortController();
    controllers.current.set(name, controller);
    setDownloads((list) => [
      { name, status: "active", phase: "preparing", completed: 0, total: 0, speed: null },
      ...list.filter((d) => d.name !== name),
    ]);

    let lastDrawn = 0;
    let lastPhase: PullPhase = "preparing";
    let sample = { at: performance.now(), completed: 0 };
    let speed: number | null = null;
    let latest: PullProgress = { phase: "preparing", completed: 0, total: 0 };
    const onProgress = (progress: PullProgress) => {
      latest = progress;
      const now = performance.now();
      if (now - sample.at >= SPEED_SAMPLE_MS && progress.phase === "downloading") {
        const measured = ((progress.completed - sample.completed) / (now - sample.at)) * 1000;
        if (measured >= 0) speed = speed === null ? measured : speed + SPEED_SMOOTHING * (measured - speed);
        sample = { at: now, completed: progress.completed };
      }
      if (progress.phase === lastPhase && now - lastDrawn < REDRAW_MS) return;
      lastDrawn = now;
      lastPhase = progress.phase;
      update(name, { ...progress, speed });
    };

    try {
      await pullModel(configFor(), name, onProgress, controller.signal);
      setDownloads((list) => list.filter((d) => d.name !== name));
      const done = { name, size: latest.total, at: Date.now() };
      setLastFinished(done);
      finished(done);
    } catch (e) {
      if (controller.signal.aborted) {
        update(name, { status: "cancelled", completed: latest.completed, total: latest.total, speed: null });
      } else {
        update(name, { status: "error", errorKind: pullErrorKind(e), error: errorMessage(e), speed: null });
      }
    } finally {
      controllers.current.delete(name);
    }
  }

  return {
    downloads,
    lastFinished,
    start,
    cancel: (name: string) => controllers.current.get(name)?.abort(),
    dismiss: (name: string) => setDownloads((list) => list.filter((d) => d.name !== name)),
  };
}
