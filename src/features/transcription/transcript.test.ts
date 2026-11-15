import { describe, expect, it } from "vitest";
import "@/shared/i18n/i18n";
import { applyLanguage } from "@/shared/i18n/i18n";
import { clock, isAudio, transcriptAttachment, transcriptFileName, transcriptText } from "./transcript";

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

  it("goes as a Markdown file named after the audio, saved under a plain name", () => {
    expect(transcriptAttachment("reunion.m4a", [])).toMatchObject({ kind: "text", name: "reunion (transcripción).md" });
    expect(transcriptFileName("Reunión del lunes.m4a")).toBe("reunion-del-lunes-transcripcion.md");
  });

  it("knows the audio it can read, and not voice notes in Opus", () => {
    const file = (name: string) => new File([], name);
    expect(isAudio(file("Reunión.M4A"))).toBe(true);
    expect(isAudio(file("nota.opus"))).toBe(false);
    expect(isAudio(file("informe.pdf"))).toBe(false);
    expect(clock(3723)).toBe("1:02:03");
  });
});
