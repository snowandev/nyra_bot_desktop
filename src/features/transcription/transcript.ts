import { extensionOf } from "@/shared/lib/paths";
import { i18n } from "@/shared/i18n/i18n";
import { LANGUAGES } from "@/shared/i18n/languages";
import type { Attachment } from "@/shared/types";
import type { TranscriptLine } from "./transcriptionStorage";

// What the audio reader takes; Opus (voice notes) isn't among them
export const AUDIO_EXTENSIONS = ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga"];

export const isAudio = (file: File) => AUDIO_EXTENSIONS.includes(extensionOf(file.name));

// 83 → "01:23", 3723 → "1:02:03"
export function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(rest)}` : `${two(minutes)}:${two(rest)}`;
}

// number: which of the audio's transcripts it is, from 1; the earlier ones stay, to compare them
const transcriptTitle = (audioName: string, number: number) =>
  number > 1
    ? i18n.t("transcription.titleAgain", { name: audioName, number })
    : i18n.t("transcription.title", { name: audioName });

// In a meeting the others are one side even when their voices weren't told apart
function whoSays(line: TranscriptLine, isMeeting: boolean) {
  if (line.you) return i18n.t("transcription.you");
  if (line.speaker !== null) return i18n.t("transcription.speaker", { n: line.speaker });
  return isMeeting ? i18n.t("transcription.others") : "";
}

// A Markdown document, as the user reads it on its card and the model gets it: a title, how long and how many speak,
// then one paragraph per turn with its time and, if known, who speaks. The labels follow the interface's language,
// as the rest of the user's data.
export function transcriptText(name: string, lines: TranscriptLine[], number = 1) {
  if (lines.length === 0) return `# ${transcriptTitle(name, number)}\n\n${i18n.t("transcription.empty", { name })}`;
  const duration = clock(lines[lines.length - 1].end);
  const isMeeting = lines.some((line) => line.you);
  const told = new Set(lines.flatMap((line) => (line.speaker === null ? [] : [line.speaker]))).size;
  // In a meeting: the user, and the others as one when their voices weren't told apart
  const others = told || (isMeeting && lines.some((line) => !line.you) ? 1 : 0);
  const speakers = others + (isMeeting ? 1 : 0);
  const about =
    speakers > 0 ? i18n.t("transcription.aboutSpeakers", { duration, count: speakers }) : duration;
  const body = lines.map((line) => {
    const name = whoSays(line, isMeeting);
    const who = name ? ` ${name}:` : "";
    return `**[${clock(line.start)}]${who}** ${line.text.replace(/\s+/g, " ")}`;
  });
  return [`# ${transcriptTitle(name, number)}`, about, ...body].join("\n\n");
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, "");

const transcriptNameOf = (audioName: string, number: number) =>
  number > 1
    ? i18n.t("transcription.fileNameAgain", { name: baseName(audioName), number })
    : i18n.t("transcription.fileName", { name: baseName(audioName) });

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whether a file has the exact name Nyra gives a transcript of this audio, in any of its languages: a transcript made
// before transcripts knew their audio is only known by it
export function isTranscriptNameOf(fileName: string, audioName: string) {
  const name = baseName(audioName);
  return LANGUAGES.some((language) => {
    const t = i18n.getFixedT(language);
    if (fileName === t("transcription.fileName", { name })) return true;
    const numbered = escaped(t("transcription.fileNameAgain", { name, number: "\u0000" })).replace("\u0000", "\\d+");
    return new RegExp(`^${numbered}$`).test(fileName);
  });
}

// The name its card offers to save it with: letters and digits of any script, and dashes. Only Latin letters lose
// their accents; in other scripts (Hindi, Thai) the marks are part of the word.
export function transcriptFileName(audioName: string) {
  const plain = `${baseName(audioName)}-${i18n.t("transcription.fileWord")}`
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${plain || i18n.t("transcription.fileWord")}.md`;
}

// The transcript goes with the message as a Markdown file named after the audio
export const transcriptAttachment = (audio: Attachment, lines: TranscriptLine[], number = 1): Attachment => ({
  id: crypto.randomUUID(),
  kind: "text",
  name: transcriptNameOf(audio.name, number),
  mimeType: "text/markdown",
  data: transcriptText(audio.name, lines, number),
  transcriptOf: audio.id,
});

// Which one the next transcript of this audio is: transcripts made before they were counted have no transcriptOf
export function nextTranscriptNumber(attached: Attachment[], audio: Attachment) {
  const made = attached.filter((a) => a.transcriptOf === audio.id).length;
  return Math.max(made, audio.transcript ? 1 : 0) + 1;
}
