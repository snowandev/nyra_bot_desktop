import { i18n } from "@/shared/i18n/i18n";
import { loadPreferences } from "@/shared/storage/settings";
import type { Attachment, Message } from "@/shared/types";
import { tagged } from "@/features/chat/reply/replyTags";
import { asAttribute } from "@/features/chat/reply/appTags";
import { extensionOf } from "@/shared/lib/paths";
import { clock } from "./transcript";
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

// What the model knows of an audio in a message: that it is there, how long it lasts, and how to have it transcribed,
// or which file holds its transcript. In English, like every instruction for it.
export function audioForModel(audio: Attachment, transcript: Attachment | undefined) {
  const name = asAttribute(audio.name);
  const open = `<audio name="${name}" duration="${clock(audio.duration ?? 0)}">`;
  if (transcript) return `${open}Already transcribed: its transcript is the file "${asAttribute(transcript.name)}".</audio>`;
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
