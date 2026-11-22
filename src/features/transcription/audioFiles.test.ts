import { describe, expect, it } from "vitest";
import type { Attachment, Message } from "@/shared/types";
import { isTranscript, withTranscript, withTranscriptLinks } from "./audioFiles";

const audio = (id: string, transcript?: string): Attachment => ({
  id,
  kind: "audio",
  name: `${id}.m4a`,
  mimeType: "audio/mp4",
  data: "",
  duration: 60,
  ...(transcript && { transcript }),
});
const text = (id: string): Attachment => ({ id, kind: "text", name: `${id}.txt`, mimeType: "text/plain", data: "…" });

describe("transcribing an audio again", () => {
  it("links the new transcript to its audio and keeps the earlier one", () => {
    const messages: Message[] = [
      { role: "user", content: "", attachments: [audio("a1", "t1"), text("t1"), audio("a2", "t2"), text("t2")] },
      { role: "assistant", content: "Listo.", transcripts: [{ at: 0, id: "t1" }] },
    ];
    const [message, reply] = withTranscript(messages, "a1", text("t3"));
    expect(message.attachments).toEqual([audio("a1", "t3"), text("t1"), audio("a2", "t2"), text("t2"), text("t3")]);
    expect(reply).toBe(messages[1]);
  });
});

describe("an audio's transcript when a conversation opens", () => {
  const transcriptOf = (id: string, name: string, of?: string): Attachment => ({
    ...text(id),
    name,
    mimeType: "text/markdown",
    ...(of && { transcriptOf: of }),
  });

  it("links an audio that lost its link to its latest transcript, in any of Nyra's languages", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: "",
        attachments: [
          audio("a1"),
          transcriptOf("t1", "a1 (transcripción).md"),
          transcriptOf("t2", "a1 (transcript 2).md", "a1"),
          transcriptOf("n1", "notas.md"),
        ],
      },
    ];
    expect(withTranscriptLinks(messages)[0].attachments?.[0]).toEqual(audio("a1", "t2"));
    const legacy: Message[] = [{ role: "user", content: "", attachments: [audio("a1"), transcriptOf("t1", "a1 (transcript).md")] }];
    expect(withTranscriptLinks(legacy)[0].attachments?.[0]).toEqual(audio("a1", "t1"));
    // The user's own notes on the audio aren't its transcript
    const notes: Message[] = [{ role: "user", content: "", attachments: [audio("a1"), transcriptOf("n1", "a1 (notas).md")] }];
    expect(withTranscriptLinks(notes)[0].attachments?.[0]).toEqual(audio("a1"));
  });

  it("leaves an audio without a transcript, and one already linked, as they are", () => {
    const messages: Message[] = [
      { role: "user", content: "", attachments: [audio("a1"), transcriptOf("n1", "notas.md")] },
      { role: "user", content: "", attachments: [audio("a2", "t9"), transcriptOf("t3", "a2 (transcript 2).md", "a2")] },
    ];
    const [first, second] = withTranscriptLinks(messages);
    expect(first.attachments?.[0]).toEqual(audio("a1"));
    expect(second).toBe(messages[1]);
  });
});

describe("telling a transcript from a file the user attached", () => {
  it("knows Nyra's transcripts, also the ones from before they knew their audio", () => {
    const named = (id: string, name: string, of?: string): Attachment => ({ ...text(id), name, ...(of && { transcriptOf: of }) });
    const attached = [audio("a1", "t1"), named("t1", "x.md"), named("t2", "a1 (transcript 2).md", "a1")];
    expect(isTranscript(attached[1], attached)).toBe(true);
    expect(isTranscript(attached[2], attached)).toBe(true);
    expect(isTranscript(named("t0", "a1 (transcripción).md"), [audio("a1")])).toBe(true);
    expect(isTranscript(named("n1", "notas.md"), attached)).toBe(false);
    expect(isTranscript(named("n2", "a1 (notas).md"), [audio("a1")])).toBe(false);
    expect(isTranscript(named("t3", "a1 (transcripción 3).md"), [audio("a1")])).toBe(true);
    expect(isTranscript(attached[0], attached)).toBe(false);
  });
});
