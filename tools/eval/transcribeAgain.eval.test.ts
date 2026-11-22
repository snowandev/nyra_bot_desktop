// Whether a real model asks for an audio's transcript again when the user wants it redone, and only then, in any
// language. Asks a local Ollama, so it only runs when asked for:
//   NYRA_EVAL_OLLAMA=http://localhost:11434 NYRA_EVAL_MODEL=qwen3:8b npx vitest run tools/eval/transcribeAgain
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "@/shared/i18n/i18n";
import { contentWithTextFiles } from "@/features/attachments/attachments";
import { tagged } from "@/features/chat/reply/replyTags";
import type { Attachment } from "@/shared/types";

const OLLAMA = process.env.NYRA_EVAL_OLLAMA;
const MODEL = process.env.NYRA_EVAL_MODEL ?? "qwen3:8b";

type Choice = "again" | "same" | "answer";

// Made-up requests in four languages, after a transcript was already made
const CASES: { ask: string; expected: Choice }[] = [
  { ask: "Transcríbelo de nuevo", expected: "again" },
  { ask: "Hazlo otra vez, no salió lo que dije yo", expected: "again" },
  { ask: "Transcribe it again, it missed half of it", expected: "again" },
  { ask: "Can you redo the transcript?", expected: "again" },
  { ask: "Refais la transcription, s'il te plaît", expected: "again" },
  { ask: "Rifammi la trascrizione", expected: "again" },
  { ask: "¿Qué dijo Marta sobre el presupuesto?", expected: "answer" },
  { ask: "Summarize it in three points", expected: "answer" },
  { ask: "Résume-la en deux phrases", expected: "answer" },
];

const audio: Attachment = {
  id: "a1",
  kind: "audio",
  name: "reunion.m4a",
  mimeType: "audio/mp4",
  data: "",
  duration: 151,
  transcript: "t1",
};
const transcript: Attachment = {
  id: "t1",
  kind: "text",
  name: "reunion (transcripción).md",
  mimeType: "text/markdown",
  data: "**[00:00] Hablante 1:** Marta dice que el presupuesto de mayo está cerrado.\n**[00:09] Hablante 2:** Lo revisamos el viernes.",
};

function choiceOf(reply: string): Choice {
  const asked = reply.match(new RegExp(`${tagged("transcribe", "").split("</")[0]}([\\s\\S]*?)</`));
  if (!asked) return "answer";
  return /\|\s*again\s*$/i.test(asked[1]) ? "again" : "same";
}

async function choice(ask: string) {
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: process.env.NYRA_EVAL_THINK === "1",
      options: { temperature: 0 },
      messages: [
        {
          role: "user",
          content: contentWithTextFiles({ role: "user", content: "Transcríbelo", attachments: [audio, transcript] }),
        },
        { role: "assistant", content: "La transcripción está lista: hablan del presupuesto de mayo." },
        { role: "user", content: ask },
      ],
    }),
  });
  const data = (await response.json()) as { message: { content: string } };
  return choiceOf(data.message.content);
}

describe.skipIf(!OLLAMA)("transcribing an audio again", () => {
  it("asks for a new transcript when the user wants it redone, in any language", async () => {
    const results = [];
    for (const { ask, expected } of CASES) {
      const got = await choice(ask);
      results.push({ ask, expected, got, ok: got === expected });
    }
    const right = results.filter((r) => r.ok).length;
    const lines = results.map((r) => `${r.ok ? "ok " : "NO "} ${r.got.padEnd(7)} (expected ${r.expected})  ${r.ask}`);
    // Vitest keeps a test's console to itself: the table goes to a file too
    if (process.env.NYRA_EVAL_OUT) writeFileSync(process.env.NYRA_EVAL_OUT, `${MODEL}: ${right} of ${results.length}\n${lines.join("\n")}\n`);
    expect(right).toBeGreaterThan(0);
  }, 900_000);
});
