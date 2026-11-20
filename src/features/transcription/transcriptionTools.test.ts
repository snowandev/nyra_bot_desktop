// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/shared/i18n/i18n";
import { applyLanguage } from "@/shared/i18n/i18n";
import { contentWithTextFiles } from "@/features/attachments/attachments";
import type { Attachment, Message } from "@/shared/types";
import { activeModel } from "./speechModels";
import { requestOf, transcriptionTools } from "./transcriptionTools";
import type { WhisperModel } from "./transcriptionStorage";

const storage = vi.hoisted(() => ({
  speechModelsStatus: vi.fn(),
  transcribeStoredAudio: vi.fn(),
  onTranscriptionProgress: vi.fn(),
  cancelTranscription: vi.fn(),
  downloadSpeechModels: vi.fn(),
  cancelSpeechDownload: vi.fn(),
  deleteSpeechModels: vi.fn(),
  storeAudio: vi.fn(),
}));
vi.mock("./transcriptionStorage", () => storage);

applyLanguage("es");

const audio: Attachment = { id: "a1", kind: "audio", name: "reunion.m4a", mimeType: "audio/mp4", data: "", duration: 151 };
const history = (attachments: Attachment[]): Message[] => [
  { role: "user", content: "¿Qué se decidió?", attachments },
];
// One Whisper added: the one used while none is chosen
const small: WhisperModel = {
  id: "small",
  name: "Whisper small",
  source: "huggingface",
  origin: "x/whisper-small",
  bytes: 1,
  format: "onnx",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  storage.speechModelsStatus.mockResolvedValue({ models: [small], sharedDownloadBytes: 0 });
  storage.onTranscriptionProgress.mockResolvedValue(() => {});
  storage.transcribeStoredAudio.mockResolvedValue([
    { start: 0, end: 4, speaker: 1, text: "Agrupamos los envíos los viernes." },
  ]);
});

describe("transcriptionTools", () => {
  it("transcribes an audio when the model asks, and keeps the transcript with its message", async () => {
    const onTranscript = vi.fn();
    const tools = transcriptionTools({
      conversationId: "c1",
      history: history([audio]),
      signal: new AbortController().signal,
      onTranscript,
      onShow: vi.fn(),
    });
    const result = await tools.run("reunion.m4a");
    expect(storage.transcribeStoredAudio).toHaveBeenCalledWith({
      id: "a1",
      extension: "m4a",
      model: "small",
      speakers: true,
      speakerCount: null,
      meeting: false,
    });
    expect(result.content).toContain('<audio-transcript name="reunion.m4a">');
    expect(result.content).toContain("**[00:00] Hablante 1:** Agrupamos los envíos los viernes.");
    expect(result.content).toMatch(/<\/audio-transcript>\n<app-instructions>[^]+<\/app-instructions>$/);
    expect(onTranscript).toHaveBeenCalledWith("a1", expect.objectContaining({ name: "reunion (transcripción).md" }));
    // Asked again in the same reply, it isn't made twice
    await tools.run("REUNION.M4A");
    expect(storage.transcribeStoredAudio).toHaveBeenCalledTimes(1);
  });

  it("gives a transcript made earlier without transcribing again", async () => {
    const transcript: Attachment = { id: "t1", kind: "text", name: "reunion (transcripción).txt", mimeType: "text/plain", data: "Ya hecha" };
    const tools = transcriptionTools({
      conversationId: "c2",
      history: history([{ ...audio, transcript: "t1" }, transcript]),
      signal: new AbortController().signal,
      onTranscript: vi.fn(),
      onShow: vi.fn(),
    });
    expect((await tools.run("reunion.m4a")).content).toContain("Ya hecha");
    expect(storage.transcribeStoredAudio).not.toHaveBeenCalled();
  });

  it("names the audio there is when asked for one that isn't, and says when transcription is off", async () => {
    const other: Attachment = { ...audio, id: "a2", name: "clase.mp3" };
    const tools = transcriptionTools({
      conversationId: "c3",
      history: history([audio, other]),
      signal: new AbortController().signal,
      onTranscript: vi.fn(),
      onShow: vi.fn(),
    });
    const missing = await tools.run("entrevista.wav");
    expect(missing.content).toContain("<transcript-error");
    expect(missing.content).toContain('"reunion.m4a", "clase.mp3"');
    localStorage.setItem("nyrabot.preferences", JSON.stringify({ transcription: false }));
    expect((await tools.run("clase.mp3")).content).toContain("turned off");
    expect(storage.transcribeStoredAudio).not.toHaveBeenCalled();
  });
});

describe("requestOf", () => {
  it("reads how many speak when the user said it, also in a name with a |", () => {
    expect(requestOf("reunion.m4a | 3")).toEqual({ name: "reunion.m4a", speakerCount: 3 });
    expect(requestOf("nota de voz.mp3|1")).toEqual({ name: "nota de voz.mp3", speakerCount: 1 });
    expect(requestOf("a | b.mp3")).toEqual({ name: "a | b.mp3", speakerCount: null });
    expect(requestOf("clase.wav")).toEqual({ name: "clase.wav", speakerCount: null });
  });

  it("passes the number on to the transcription", async () => {
    const tools = transcriptionTools({
      conversationId: "c4",
      history: history([audio]),
      signal: new AbortController().signal,
      onTranscript: vi.fn(),
      onShow: vi.fn(),
    });
    await tools.run("reunion.m4a | 1");
    expect(storage.transcribeStoredAudio).toHaveBeenCalledWith(expect.objectContaining({ speakerCount: 1 }));
  });
});

describe("an audio in a message", () => {
  it("tells the model how to have it transcribed, or where its transcript is", () => {
    const pending = contentWithTextFiles({ role: "user", content: "Resúmelo", attachments: [audio] });
    expect(pending).toContain('<audio name="reunion.m4a" duration="02:31">');
    expect(pending).toContain("<nyra-transcribe>reunion.m4a</nyra-transcribe>");
    expect(pending).toContain("<nyra-transcribe>reunion.m4a | 2</nyra-transcribe>");
    const transcript: Attachment = { id: "t1", kind: "text", name: "reunion (transcripción).txt", mimeType: "text/plain", data: "texto" };
    const done = contentWithTextFiles({
      role: "user",
      content: "Resúmelo",
      attachments: [{ ...audio, transcript: "t1" }, transcript],
    });
    expect(done).toContain('its transcript is the file "reunion (transcripción).txt"');
    expect(done).not.toContain("<nyra-transcribe>");
  });
});

describe("activeModel", () => {
  it("uses the chosen Whisper while it is there, else the first one added", () => {
    const medium = { ...small, id: "medium", name: "Whisper medium" };
    const status = { models: [small, medium], sharedDownloadBytes: 0 };
    expect(activeModel(status, "medium")?.id).toBe("medium");
    expect(activeModel(status, "deleted")?.id).toBe("small");
    expect(activeModel(status, null)?.id).toBe("small");
    expect(activeModel({ models: [], sharedDownloadBytes: 0 }, "small")).toBeNull();
  });
});

