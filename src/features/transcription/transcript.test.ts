import { describe, expect, it } from "vitest";
import "@/shared/i18n/i18n";
import { applyLanguage } from "@/shared/i18n/i18n";
import type { Attachment } from "@/shared/types";
import { isAudio, nextTranscriptNumber, transcriptAttachment, transcriptFileName, transcriptText } from "./transcript";

applyLanguage("es");

describe("transcripts", () => {
  it("writes each turn with its time and its speaker", () => {
    const text = transcriptText("reunion.m4a", [
      { start: 0.2, end: 5.4, speaker: 1, text: "Hola, empecemos." },
      { start: 7.3, end: 3725, speaker: 2, text: "Traigo las cifras de mayo." },
    ]);
    expect(text.split("\n\n")).toEqual([
      "# Transcripción de reunion.m4a",
      "1:02:05 · 2 hablantes",
      "**[00:00] Hablante 1:** Hola, empecemos.",
      "**[00:07] Hablante 2:** Traigo las cifras de mayo.",
    ]);
  });

  it("leaves the speaker out when voices weren't told apart, and says when nobody speaks", () => {
    expect(transcriptText("nota.mp3", [{ start: 83, end: 90, speaker: null, text: "Comprar pan." }])).toContain(
      "**[01:23]** Comprar pan.",
    );
    expect(transcriptText("silencio.wav", [])).toContain("No se oye a nadie hablar en silencio.wav.");
  });

  it("names the user and the others in a meeting Nyra recorded", () => {
    const text = transcriptText("Reunión.wav", [
      { start: 1, end: 3, speaker: null, text: "Empecemos.", you: true },
      { start: 4, end: 9, speaker: null, text: "Traigo las cifras." },
    ]);
    expect(text.split("\n\n").slice(1)).toEqual([
      "00:09 · 2 hablantes",
      "**[00:01] Tú:** Empecemos.",
      "**[00:04] Los demás:** Traigo las cifras.",
    ]);
  });

  it("goes as a Markdown file named after the audio, saved under a plain name", () => {
    const audio: Attachment = { id: "a1", kind: "audio", name: "reunion.m4a", mimeType: "audio/mp4", data: "" };
    const first = transcriptAttachment(audio, []);
    expect(first).toMatchObject({ kind: "text", name: "reunion (transcripción).md", transcriptOf: "a1" });
    const second = transcriptAttachment(audio, [], 2);
    expect(second.name).toBe("reunion (transcripción 2).md");
    expect(second.data).toMatch(/^# Transcripción 2 de reunion\.m4a/);
    expect(transcriptFileName("Reunión del lunes.m4a")).toBe("reunion-del-lunes-transcripcion.md");
    expect(transcriptFileName("会議 3月.m4a")).toBe("会議-3月-transcripcion.md");
    expect(transcriptFileName("Встреча.m4a")).toBe("встреча-transcripcion.md");
    expect(transcriptFileName("बैठक.m4a")).toBe("बैठक-transcripcion.md");
  });

  it("numbers a new transcript after the ones the audio already has", () => {
    const audio: Attachment = { id: "a1", kind: "audio", name: "reunion.m4a", mimeType: "audio/mp4", data: "" };
    expect(nextTranscriptNumber([audio], audio)).toBe(1);
    const first = transcriptAttachment(audio, []);
    expect(nextTranscriptNumber([{ ...audio, transcript: first.id }, first], { ...audio, transcript: first.id })).toBe(2);
    // Made before they were counted: only the audio knows it has one
    expect(nextTranscriptNumber([], { ...audio, transcript: "old" })).toBe(2);
  });

  it("knows the audio it can read, and not voice notes in Opus", () => {
    const file = (name: string) => new File([], name);
    expect(isAudio(file("Reunión.M4A"))).toBe(true);
    expect(isAudio(file("nota.opus"))).toBe(false);
    expect(isAudio(file("informe.pdf"))).toBe(false);
  });
});
