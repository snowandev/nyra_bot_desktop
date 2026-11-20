import { extensionOf } from "@/shared/lib/paths";
import { i18n } from "@/shared/i18n/i18n";
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

const transcriptTitle = (audioName: string) => i18n.t("transcription.title", { name: audioName });

// In a meeting the others are one side even when their voices weren't told apart
function whoSays(line: TranscriptLine, isMeeting: boolean) {
  if (line.you) return i18n.t("transcription.you");
  if (line.speaker !== null) return i18n.t("transcription.speaker", { n: line.speaker });
  return isMeeting ? i18n.t("transcription.others") : "";
}

// A Markdown document, as the user reads it on its card and the model gets it: a title, how long and how many speak,
// then one paragraph per turn with its time and, if known, who speaks. The labels follow the interface's language,
// as the rest of the user's data.
export function transcriptText(name: string, lines: TranscriptLine[]) {
  if (lines.length === 0) return `# ${transcriptTitle(name)}\n\n${i18n.t("transcription.empty", { name })}`;
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
  return [`# ${transcriptTitle(name)}`, about, ...body].join("\n\n");
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, "");

export const transcriptNameOf = (audioName: string) => i18n.t("transcription.fileName", { name: baseName(audioName) });

// The name its card offers to save it with: letters, digits and dashes only, as the save dialog takes them
export function transcriptFileName(audioName: string) {
  const plain = `${baseName(audioName)}-${i18n.t("transcription.fileWord")}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${plain || i18n.t("transcription.fileWord")}.md`;
}

// The transcript goes with the message as a Markdown file named after the audio
export const transcriptAttachment = (name: string, lines: TranscriptLine[]): Attachment => ({
  id: crypto.randomUUID(),
  kind: "text",
  name: transcriptNameOf(name),
  mimeType: "text/markdown",
  data: transcriptText(name, lines),
});
