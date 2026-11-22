import { i18n } from "@/shared/i18n/i18n";
import { loadPreferences } from "@/shared/storage/settings";
import type { Attachment, Message } from "@/shared/types";
import { tagged } from "@/features/chat/reply/replyTags";
import { asAttribute } from "@/features/chat/reply/appTags";
import { extensionOf } from "@/shared/lib/paths";
import { clock, isTranscriptNameOf } from "./transcript";
import { storeAudio } from "./transcriptionStorage";

// An attached audio, kept as a file in Nyra's data folder: the message only carries its name and length. Nothing is
// transcribed until a reply needs it.
export async function storeAudioFile(file: File): Promise<Attachment> {
  if (!loadPreferences().transcription) throw new Error(i18n.t("transcription.disabled"));
  const id = crypto.randomUUID();
  const duration = await storeAudio(await file.arrayBuffer(), id, extensionOf(file.name));
  return { id, kind: "audio", name: file.name, mimeType: file.type || "audio/*", data: "", duration };
}

// The files of the audio attached in these messages
export const audioIdsOf = (messages: Message[]) =>
  messages
    .flatMap((m) => m.attachments ?? [])
    .filter((a) => a.kind === "audio")
    .map((a) => a.id);

// The messages with this transcript as the audio's latest; the earlier ones stay, to compare them
export const withTranscript = (messages: Message[], audioId: string, transcript: Attachment): Message[] =>
  messages.map((m) =>
    m.attachments?.some((a) => a.id === audioId)
      ? {
          ...m,
          attachments: [
            ...m.attachments.map((a) => (a.id === audioId ? { ...a, transcript: transcript.id } : a)),
            transcript,
          ],
        }
      : m,
  );

// A transcript made before transcripts knew their audio: only its name tells, exactly as Nyra writes it
const namedAfter = (file: Attachment, audio: Attachment) =>
  !file.transcriptOf && isTranscriptNameOf(file.name, audio.name);

// One of the transcripts Nyra made of an audio in these attachments, not a file the user attached
export const isTranscript = (file: Attachment, attached: Attachment[]) =>
  file.kind === "text" &&
  (!!file.transcriptOf || attached.some((a) => a.kind === "audio" && (a.transcript === file.id || namedAfter(file, a))));

// Each audio linked to its latest transcript. Before the link was kept, conversations lost it when saved: their
// transcript is the last file in the audio's message named after it, "reunion (…).md" in any language.
export function withTranscriptLinks(messages: Message[]): Message[] {
  return messages.map((m) => {
    const attached = m.attachments ?? [];
    if (!attached.some((a) => a.kind === "audio" && !a.transcript)) return m;
    const latestOf = (audio: Attachment) => {
      const files = attached.filter((a) => a.kind === "text").reverse();
      return files.find((a) => a.transcriptOf === audio.id) ?? files.find((a) => namedAfter(a, audio));
    };
    return {
      ...m,
      attachments: attached.map((a) => {
        if (a.kind !== "audio" || a.transcript) return a;
        const transcript = latestOf(a);
        return transcript ? { ...a, transcript: transcript.id } : a;
      }),
    };
  });
}

// What the model knows of an audio in a message: that it is there, how long it lasts, and how to have it transcribed,
// or which file holds its transcript. In English, like every instruction for it.
export function audioForModel(audio: Attachment, transcript: Attachment | undefined) {
  const name = asAttribute(audio.name);
  const open = `<audio name="${name}" duration="${clock(audio.duration ?? 0)}">`;
  if (transcript) {
    return (
      `${open}Already transcribed: its latest transcript is the file "${asAttribute(transcript.name)}". If the user ` +
      "wants it transcribed again (to redo it, because it came out wrong or missed parts), write " +
      `${tagged("transcribe", `${audio.name} | again`)} and you get a new one, kept next to the earlier ones so they ` +
      "can be compared; add the number of " +
      `people before it if they said it (${tagged("transcribe", `${audio.name} | 2 | again`)}). Otherwise use the ` +
      "transcript you have.</audio>"
    );
  }
  if (!loadPreferences().transcription) {
    const feature = i18n.t("settings.features.transcription.title");
    return (
      `${open}You can't hear it, and it can't be transcribed: audio transcription is turned off. If the user wants ` +
      `what it says, tell them to turn on "${feature}" in Settings.</audio>`
    );
  }
  return (
    `${open}You can't hear it and it isn't transcribed yet. If what the user asks needs what is said in it ` +
    `(transcribe it, summarize it, what someone said), write ${tagged("transcribe", audio.name)} and you get its ` +
    "transcript, with times and speakers. If they said how many people speak in it, add the number after a | " +
    `(${tagged("transcribe", `${audio.name} | 2`)}; 1 when only one person speaks), so the voices are told apart ` +
    "right. If they ask something else, don't ask for it.</audio>"
  );
}
