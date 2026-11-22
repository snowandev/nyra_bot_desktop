import { type RefObject, useEffect, useRef, useState } from "react";
import { useAppEvent } from "@/shared/hooks/useAppEvent";
import { activeModel, refreshSpeechModels } from "@/features/transcription/speechModels";
import { useStableCallback } from "@/shared/hooks/useStableCallback";
import { errorMessage } from "@/shared/lib/errors";
import { loadPreferences } from "@/shared/storage/settings";
import { insertDictation } from "./dictationText";
import { cancelDictation, onDictationEnded, onDictationLevel, startDictation, stopDictation } from "./dictationStorage";

type DictationState = "idle" | "starting" | "recording" | "transcribing";

export type DictationNotice =
  | { kind: "needsModel" }
  | { kind: "nothingHeard" }
  | { kind: "error"; message: string };

type Options = {
  // The box the text goes into, where its cursor is
  inputRef: RefObject<HTMLTextAreaElement | null>;
  // Another one means the box now edits another draft (another conversation)
  onChange: (text: string) => void;
};

// Speaking instead of writing: a click starts recording, another writes what was said where the cursor is, Esc drops
// it. The Whisper is the one chosen for audio; without any added, the notice says where to add one.
export function useDictation({ inputRef, onChange }: Options) {
  const [state, setState] = useState<DictationState>("idle");
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<DictationNotice | null>(null);
  // Read at once by a second click or a held key, before React draws again
  const phase = useRef<DictationState>("idle");
  // Counts the dictations dropped (Esc, another draft, the box gone): one that ends after it was dropped writes nothing
  const dropped = useRef(0);
  // The Whisper it started with, which writes what was said
  const model = useRef("");

  function enter(next: DictationState) {
    phase.current = next;
    setState(next);
  }

  function write(spoken: string) {
    const box = inputRef.current;
    if (!box) return;
    const inserted = insertDictation(box.value, spoken, box.selectionStart, box.selectionEnd);
    onChange(inserted.text);
    requestAnimationFrame(() => {
      box.focus();
      box.setSelectionRange(inserted.caret, inserted.caret);
    });
  }

  async function start() {
    enter("starting");
    setNotice(null);
    const turn = dropped.current;
    const status = await refreshSpeechModels();
    if (turn !== dropped.current) return;
    const whisper = activeModel(status, loadPreferences().transcriptionModel);
    if (!whisper) {
      enter("idle");
      setNotice({ kind: "needsModel" });
      return;
    }
    model.current = whisper.id;
    try {
      await startDictation(whisper.id, loadPreferences().microphone?.id ?? null);
      // Dropped while the microphone opened
      if (turn !== dropped.current) {
        void cancelDictation();
        return;
      }
      setLevel(0);
      enter("recording");
    } catch (e) {
      if (turn !== dropped.current) return;
      enter("idle");
      setNotice({ kind: "error", message: errorMessage(e) });
    }
  }

  // The end of the recording's time and the user's click may both arrive: the first one stops it
  const stop = useStableCallback(async () => {
    if (phase.current !== "recording") return;
    enter("transcribing");
    const turn = dropped.current;
    try {
      const spoken = await stopDictation(model.current);
      if (turn !== dropped.current) return;
      if (spoken.trim()) write(spoken);
      else setNotice({ kind: "nothingHeard" });
    } catch (e) {
      if (turn === dropped.current) setNotice({ kind: "error", message: errorMessage(e) });
    } finally {
      if (turn === dropped.current) enter("idle");
    }
  });

  function toggle() {
    if (phase.current === "idle") void start();
    else if (phase.current === "recording") void stop();
  }

  // Drops what is being recorded or written; true if there was something
  const drop = useStableCallback(() => {
    if (phase.current === "idle") return false;
    dropped.current++;
    // Recording, it stops; being written, it stops at the next phrase instead of using the computer for nothing
    void cancelDictation();
    enter("idle");
    return true;
  });

  const cancel = useStableCallback(() => {
    if (phase.current === "recording") drop();
  });

  const isRecording = state === "recording";
  useAppEvent(onDictationLevel, setLevel, isRecording);
  useAppEvent(onDictationEnded, () => void stop(), isRecording);
  useEffect(() => {
    if (!isRecording) return;
    // Esc drops it before anything else hears the key (closing the quick bar, a menu)
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isRecording, cancel]);

  // The box moves to another draft, or goes away: what was being said there isn't written in another place, and the
  // microphone doesn't stay open
  useEffect(() => () => void drop(), [onChange, drop]);

  return { state, level, notice, toggle, cancel, drop, dismiss: () => setNotice(null) };
}
