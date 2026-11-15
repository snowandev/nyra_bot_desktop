import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";
import { changesBetween, type WorkspaceChanges } from "./workspace";
import { withSecretsHidden } from "@/features/sensitive-data/sensitiveData";
import { useWindowFocusRefresh } from "@/shared/hooks/useWindowFocusRefresh";
import { embed, embeddingModelOf } from "@/providers/ollamaModels";
import {
  type IndexedFile,
  indexWorkspace,
  meaningChunks,
  meaningPending,
  meaningStore,
  pickWorkspaceFolder,
  revealWorkspaceFile,
} from "./workspaceStorage";
import type { ProviderConfig, WorkspaceFolder } from "@/shared/types";

export type WorkspaceState =
  | { kind: "indexing" }
  | { kind: "ready"; files: IndexedFile[]; skipped: number; truncated: boolean }
  | { kind: "empty"; skipped: number }
  | { kind: "missing" }
  | { kind: "noAccess" }
  | { kind: "error"; message: string };

// Whether the folder can be searched by meaning: the vectors of its files are made in the background once it is
// connected, with an embedding model of Ollama; later only the files that changed are done again
export type MeaningState =
  | { kind: "preparing"; done: number; total: number }
  | { kind: "ready"; model: string }
  // No embedding model in Ollama, or Ollama doesn't answer
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

// The folder as it is right before a reply, and what changed since the conversation's last message
export type WorkspaceSnapshot = {
  folder: WorkspaceFolder;
  files: IndexedFile[];
  truncated: boolean;
  changes: WorkspaceChanges | null;
  // The embedding model its vectors were made with, when it can be searched by meaning
  meaningModel: string | null;
};

// Files read and cut into fragments at a time, and fragments sent to the model at a time
const FILES_PER_BATCH = 8;
const TEXTS_PER_EMBED = 32;
// Before a reply, this few changed files are worth waiting for (under a second), so searching by meaning finds what
// just changed; more (a git pull) go on in the background. The wait never goes past the cap.
const WAIT_FOR_FILES = 20;
const MAX_WAIT_MS = 3000;

// A run of the vectors: how many files it has to do, known as soon as it compares, when it ends, and how to stop it
type MeaningRun = { pending: Promise<number>; done: Promise<void>; controller: AbortController };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Options = {
  // Where the embedding model is: Ollama, wherever the chat's model runs
  ollamaConfig: ProviderConfig;
  // Settings → General → Funciones de Nyra
  meaning: boolean;
  // The embedding model the user chose there; null lets Nyra choose
  embeddingModel: string | null;
};

const sameFiles = (a: IndexedFile[], b: IndexedFile[]) =>
  a.length === b.length && a.every((f, i) => f.path === b[i].path && f.modified === b[i].modified && f.size === b[i].size);

function sameState(before: WorkspaceState | undefined, after: WorkspaceState) {
  if (!before || before.kind !== after.kind) return false;
  if (before.kind === "ready" && after.kind === "ready") {
    return before.skipped === after.skipped && before.truncated === after.truncated && sameFiles(before.files, after.files);
  }
  if (before.kind === "empty" && after.kind === "empty") return before.skipped === after.skipped;
  if (before.kind === "error" && after.kind === "error") return before.message === after.message;
  return before.kind !== "indexing";
}

async function indexState(path: string): Promise<WorkspaceState> {
  try {
    const outcome = await indexWorkspace(path);
    if (outcome.kind !== "ready") return outcome;
    return outcome.files.length > 0 ? outcome : { kind: "empty", skipped: outcome.skipped };
  } catch (e) {
    return { kind: "error", message: errorMessage(e) };
  }
}

// The index of each connected folder, by path. It is read again before every reply, so new and changed files are
// always there without watching the folder (watchers behave differently on each system and with large folders).
export function useWorkspaces({ ollamaConfig, meaning, embeddingModel }: Options) {
  const [states, setStates] = useState<Map<string, WorkspaceState>>(new Map());
  // For the focus listener, which shouldn't be set up again on every change
  const statesRef = useRef(states);
  useLayoutEffect(() => {
    statesRef.current = states;
  });
  const [meanings, setMeanings] = useState<Map<string, MeaningState>>(new Map());
  // The files each conversation's folder had at its last message, to say what changed since
  const lastSent = useRef(new Map<string, { path: string; files: IndexedFile[] }>());
  // Read when the background work runs, so it always uses the current settings
  const settings = useRef({ ollamaConfig, meaning, embeddingModel });
  useLayoutEffect(() => {
    settings.current = { ollamaConfig, meaning, embeddingModel };
  });
  // The model each folder was last made ready with: while a few changed files are done again it stays searchable
  const readyModel = useRef(new Map<string, string>());
  const running = useRef(new Set<string>());
  const again = useRef(new Set<string>());

  // Read again unchanged, the same state stays: nothing that shows it draws again
  const setState = useCallback((path: string, state: WorkspaceState) => {
    setStates((current) => (sameState(current.get(path), state) ? current : new Map(current).set(path, state)));
  }, []);

  const setMeaning = useCallback((path: string, state: MeaningState) => {
    if (state.kind === "ready") readyModel.current.set(path, state.model);
    else if (state.kind !== "preparing") readyModel.current.delete(path);
    setMeanings((current) => new Map(current).set(path, state));
  }, []);

  // The latest run of each folder, so a reply can wait for a small one
  const runs = useRef(new Map<string, MeaningRun>());

  // While a local model writes a reply the vectors wait: loading the embedding model next to it could push the chat
  // model out of memory, and the reply would stall while it loads again. Several replies may hold it at once.
  const pauses = useRef(0);
  const resumers = useRef<(() => void)[]>([]);
  const pauseMeaning = useCallback(() => {
    pauses.current++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      pauses.current--;
      if (pauses.current === 0) resumers.current.splice(0).forEach((resume) => resume());
    };
  }, []);

  const forgetMeaning = useCallback((path: string) => {
    readyModel.current.delete(path);
    setMeanings((current) => {
      const next = new Map(current);
      next.delete(path);
      return next;
    });
  }, []);

  // Makes the vectors of the files that are new or changed; one run per folder at a time, and one more if it was
  // asked for meanwhile
  const prepareMeaning = useCallback(
    (path: string): Promise<void> => {
      const { ollamaConfig: config, meaning: enabled, embeddingModel: preferred } = settings.current;
      if (!enabled) return Promise.resolve();
      if (running.current.has(path)) {
        again.current.add(path);
        return runs.current.get(path)?.done ?? Promise.resolve();
      }
      running.current.add(path);
      let tellPending: (count: number) => void = () => {};
      const pending = new Promise<number>((resolve) => (tellPending = resolve));
      const controller = new AbortController();
      const { signal } = controller;
      const stopIfCancelled = () => {
        // Never shown: a stop on purpose is caught below
        if (signal.aborted) throw new DOMException("Folder preparation stopped", "AbortError");
      };
      // Resolves at once unless a reply is being written; stopping it also ends the wait
      const unpaused = () =>
        pauses.current === 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              resumers.current.push(resolve);
              signal.addEventListener("abort", () => resolve(), { once: true });
            });
      const done = (async () => {
        try {
          const model = await embeddingModelOf(config, preferred);
          stopIfCancelled();
          if (!model) {
            tellPending(0);
            return setMeaning(path, { kind: "unavailable" });
          }
          const paths = await meaningPending(path, model);
          tellPending(paths.length);
          const wasReady = readyModel.current.get(path) === model;
          if (!wasReady && paths.length > 0) setMeaning(path, { kind: "preparing", done: 0, total: paths.length });
          for (let i = 0; i < paths.length; i += FILES_PER_BATCH) {
            await unpaused();
            stopIfCancelled();
            const chunks = await meaningChunks(path, paths.slice(i, i + FILES_PER_BATCH));
            // The path goes with the text: a file's name also says what its code is about. Ollama may be on another
            // computer, so secret values stay out as they do for the chat model.
            const texts = chunks.filter((c) => c.text).map((c) => `${c.path}\n${withSecretsHidden(c.text).text}`);
            const vectors: number[][] = [];
            for (let j = 0; j < texts.length; j += TEXTS_PER_EMBED) {
              vectors.push(...(await embed(config, model, texts.slice(j, j + TEXTS_PER_EMBED), signal)));
            }
            stopIfCancelled();
            let next = 0;
            await meaningStore(
              path,
              model,
              chunks.map(({ text, ...chunk }) => ({ ...chunk, vector: text ? vectors[next++] : [] })),
            );
            if (!wasReady) {
              const finished = Math.min(paths.length, i + FILES_PER_BATCH);
              setMeaning(path, { kind: "preparing", done: finished, total: paths.length });
            }
          }
          setMeaning(path, { kind: "ready", model });
        } catch (e) {
          tellPending(0);
          // Stopped on purpose (turned off, Nyra closing): what was stored stays and is used once it is back on
          if (signal.aborted) forgetMeaning(path);
          else setMeaning(path, { kind: "error", message: errorMessage(e) });
        } finally {
          running.current.delete(path);
          // Asked again while it ran, also when it was stopped to start over with another model
          if (again.current.delete(path)) void prepareMeaning(path);
        }
      })();
      runs.current.set(path, { pending, done, controller });
      return done;
    },
    [setMeaning, forgetMeaning],
  );

  // Before a reply: waits for the run in course if it has only a few files left, never longer than the cap
  const meaningUpToDate = useCallback(async (path: string) => {
    const run = runs.current.get(path);
    if (!run) return;
    const pending = await Promise.race([run.pending, wait(MAX_WAIT_MS).then(() => Infinity)]);
    if (pending > 0 && pending <= WAIT_FOR_FILES) await Promise.race([run.done, wait(MAX_WAIT_MS)]);
  }, []);

  const refresh = useCallback(
    async (path: string) => {
      // A folder already shown keeps its count while it is read again
      setStates((current) => (current.get(path)?.kind === "ready" ? current : new Map(current).set(path, { kind: "indexing" })));
      const state = await indexState(path);
      setState(path, state);
      // In the background: replies don't wait for it
      if (state.kind === "ready") void prepareMeaning(path);
      return state;
    },
    [setState, prepareMeaning],
  );

  // Rejects if the dialog can't open; null when the user closes it
  const pick = useCallback(
    async (remember: boolean) => {
      const folder = await pickWorkspaceFolder(remember);
      if (folder) void refresh(folder.path);
      return folder;
    },
    [refresh],
  );

  const prepare = useCallback(
    async (conversationId: string, folder: WorkspaceFolder): Promise<WorkspaceSnapshot | null> => {
      const state = await refresh(folder.path);
      if (state.kind !== "ready") return null;
      await meaningUpToDate(folder.path);
      const before = lastSent.current.get(conversationId);
      lastSent.current.set(conversationId, { path: folder.path, files: state.files });
      const changes = before?.path === folder.path ? changesBetween(before.files, state.files) : null;
      const meaningModel = settings.current.meaning ? (readyModel.current.get(folder.path) ?? null) : null;
      return { folder, files: state.files, truncated: state.truncated, changes, meaningModel };
    },
    [refresh, meaningUpToDate],
  );

  // Back from another app (the editor, a git pull in the terminal): the connected folders are read again in the
  // background, so their vectors are usually up to date by the time the user asks
  // Coming back to Nyra, only the folder of the open conversation is read again: the others are read before their next
  // reply anyway, and reading every connected folder each time was most of the work
  const shown = useRef<string | null>(null);
  const show = useCallback((path: string | null) => {
    shown.current = path;
  }, []);
  useWindowFocusRefresh(() => {
    const path = shown.current;
    if (path && statesRef.current.get(path)?.kind === "ready") void refresh(path);
  });

  // Turned on: the connected folders get ready. Turned off (or Nyra closing): the runs in course stop. Another model
  // chosen: they stop and start over with it, since vectors of different models can't be compared.
  useEffect(() => {
    if (!meaning) return;
    for (const [path, state] of statesRef.current) if (state.kind === "ready") void prepareMeaning(path);
    const active = runs.current;
    return () => {
      for (const run of active.values()) run.controller.abort();
    };
  }, [meaning, embeddingModel, prepareMeaning]);

  // Folders no conversation uses any more: nothing is read, indexed or prepared for them again
  const forget = useCallback((paths: string[]) => {
    const gone = new Set(paths);
    const without = <T,>(current: Map<string, T>) => new Map([...current].filter(([path]) => !gone.has(path)));
    for (const path of gone) {
      runs.current.get(path)?.controller.abort();
      runs.current.delete(path);
      again.current.delete(path);
      readyModel.current.delete(path);
    }
    for (const [conversationId, sent] of lastSent.current) if (gone.has(sent.path)) lastSent.current.delete(conversationId);
    setStates(without);
    setMeanings(without);
  }, []);

  const stateOf = useCallback((path: string) => states.get(path) ?? null, [states]);
  const meaningOf = useCallback((path: string) => meanings.get(path) ?? null, [meanings]);
  const reveal = useCallback((root: string, path = "") => revealWorkspaceFile(root, path), []);

  // Shared through a context and read inside the memoized chat messages: a new object only when something changed
  return useMemo(
    () => ({ stateOf, meaningOf, refresh, pick, prepare, reveal, pauseMeaning, forget, show }),
    [stateOf, meaningOf, refresh, pick, prepare, reveal, pauseMeaning, forget, show],
  );
}
