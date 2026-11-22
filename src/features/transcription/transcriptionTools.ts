import { asAttribute, neutralizeAppTags } from "@/features/chat/reply/appTags";
import { errorMessage } from "@/shared/lib/errors";
import { loadPreferences } from "@/shared/storage/settings";
import type { Attachment, Message } from "@/shared/types";
import { activeModel, refreshSpeechModels, whenModelReady } from "./speechModels";
import { extensionOf } from "@/shared/lib/paths";
import { nextTranscriptNumber, transcriptAttachment } from "./transcript";
import { endTranscription, showTranscription, type TranscriptionState } from "./transcriptionSession";
import { cancelTranscription, onTranscriptionProgress, transcribeStoredAudio } from "./transcriptionStorage";

// A long meeting is tens of thousands of words: the model gets this much of a transcript, and the user the whole
const MAX_TRANSCRIPT_CHARS = 120_000;

type Options = {
  conversationId: string;
  // The conversation as the reply got it: its audio, and the transcripts already made
  history: Message[];
  signal: AbortSignal;
  // A transcript made in this reply, to keep with the message that brought its audio
  onTranscript: (audioId: string, transcript: Attachment) => void;
  // A transcript the reply got, new or made before: its card goes in the reply
  onShow: (transcriptId: string) => void;
};

const result = (content: string): Message => ({ role: "user", content });

// The user already sees it whole, as a document in the reply: the model answers what they asked about it
const SHOWN_NOTE =
  "The user sees this whole transcript as a document in your reply and can save it: never copy it out or list its " +
  "lines. Answer what they asked about it (a summary, a question). If they only asked for the transcript, say in a " +
  "sentence or two that it is ready and what it is about, and offer a summary.";

const transcriptFor = (name: string, text: string) => {
  const cut = text.length > MAX_TRANSCRIPT_CHARS;
  const shown = cut ? text.slice(0, MAX_TRANSCRIPT_CHARS) : text;
  const note = cut ? "\n[The transcript goes on: this is its beginning. The user has it whole.]" : "";
  return result(
    `<audio-transcript name="${asAttribute(name)}">\n${neutralizeAppTags(shown)}${note}\n</audio-transcript>\n` +
      `<app-instructions>${SHOWN_NOTE}</app-instructions>`,
  );
};

const failure = (name: string, error: string) =>
  result(`<transcript-error name="${asAttribute(name)}">${neutralizeAppTags(error)}</transcript-error>`);

// "reunion.m4a | 3 | again": the audio's name, how many speak when the user said it, and whether to make it again
export function requestOf(value: string) {
  let name = value;
  let speakerCount: number | null = null;
  let again = false;
  for (;;) {
    const match = name.match(/^([\s\S]*?)\s*\|\s*(\d{1,3}|again)\s*$/i);
    if (!match) break;
    if (match[2].toLowerCase() === "again") again = true;
    else speakerCount ??= Number(match[2]);
    name = match[1];
  }
  return { name, speakerCount, again };
}

// The model's way to hear an attached audio: it asks for its transcript, made on this computer when it first asks.
// The user downloads the model if it is missing, and may stop it.
export function transcriptionTools({ conversationId, history, signal, onTranscript, onShow }: Options) {
  const attached = history.flatMap((m) => m.attachments ?? []);
  const audios = attached.filter((a) => a.kind === "audio");
  // Made in this reply, by audio id
  const made = new Map<string, Attachment>();

  // By its name as the model wrote it; with a single audio, that one
  function audioNamed(value: string) {
    const wanted = value.trim().toLowerCase();
    return audios.find((a) => a.name.toLowerCase() === wanted) ?? (audios.length === 1 ? audios[0] : undefined);
  }

  async function transcribe(audio: Attachment, speakerCount: number | null): Promise<Message> {
    const { transcriptionSpeakers: speakers } = loadPreferences();
    const stopping = new AbortController();
    const stop = () => stopping.abort();
    // Wired before anything is awaited, so no stop falls in a gap; a reply already stopped never starts it
    if (signal.aborted) stop();
    signal.addEventListener("abort", stop);
    const run = crypto.randomUUID();
    const cancel = () => void cancelTranscription(run);
    stopping.signal.addEventListener("abort", cancel);
    const show = (state: TranscriptionState) =>
      showTranscription(conversationId, { name: audio.name, state, cancel: stop });
    let unlisten = () => {};
    try {
      unlisten = await onTranscriptionProgress((progress) => {
        if (progress.id === audio.id) show({ kind: progress.stage, progress: progress.progress });
      });
      // Without any Whisper it waits for one added in Settings, and goes on by itself
      const chosen = () => loadPreferences().transcriptionModel;
      let whisper = activeModel(await refreshSpeechModels(), chosen());
      if (!whisper) {
        show({ kind: "needsModel" });
        whisper = await whenModelReady(chosen, stopping.signal);
      }
      const model = whisper.id;
      stopping.signal.throwIfAborted();
      show({ kind: "reading", progress: 0 });
      const lines = await transcribeStoredAudio({
        id: audio.id,
        extension: extensionOf(audio.name),
        model,
        speakers,
        speakerCount,
        meeting: audio.meeting === true,
        run,
      });
      const transcript = transcriptAttachment(audio, lines, nextTranscriptNumber(attached, audio));
      made.set(audio.id, transcript);
      onTranscript(audio.id, transcript);
      onShow(transcript.id);
      return transcriptFor(audio.name, transcript.data);
    } catch (e) {
      if (stopping.signal.aborted && !signal.aborted) {
        return result(
          `<transcript-error name="${asAttribute(audio.name)}">The user stopped the transcription. Don't ask for it ` +
            "again in this reply; tell them you can do it when they want.</transcript-error>",
        );
      }
      return failure(audio.name, errorMessage(e));
    } finally {
      unlisten();
      signal.removeEventListener("abort", stop);
      stopping.signal.removeEventListener("abort", cancel);
      endTranscription(conversationId);
    }
  }

  return {
    // Only a conversation with audio can ask
    hasAudio: audios.length > 0,
    async run(value: string): Promise<Message> {
      const { name, speakerCount, again } = requestOf(value);
      const audio = audioNamed(name);
      if (!audio) {
        const names = audios.map((a) => `"${asAttribute(a.name)}"`).join(", ");
        return failure(value, `There's no audio by that name. The audio in this conversation: ${names}.`);
      }
      // Again means the one made before this reply; one made in it already is the new one
      const earlier = again ? undefined : attached.find((a) => a.id === audio.transcript);
      const done = made.get(audio.id) ?? earlier;
      if (done) {
        onShow(done.id);
        return transcriptFor(audio.name, done.data);
      }
      if (!loadPreferences().transcription) {
        return failure(audio.name, "Audio transcription is turned off in Settings: tell the user to turn it on.");
      }
      return transcribe(audio, speakerCount);
    },
  };
}
