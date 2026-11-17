// Which tool a real model reaches for first, with the instructions a reply gets when the web search, Nyra's browser
// and the user's screen are all available. Asks a local Ollama, so it only runs when asked for:
//   NYRA_EVAL_OLLAMA=http://localhost:11434 NYRA_EVAL_MODEL=qwen3:8b npx vitest run tools/eval/toolChoice
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { browserPrompt } from "@/features/browser/browserTools";
import { screenPrompt } from "@/features/screen-look/screenTools";
import { toolChoicePrompt } from "@/features/chat/reply/toolChoice";
import { isBrowserRequest, isScreenRequest, REQUEST_KINDS, tagged } from "@/features/chat/reply/replyTags";
import { SEARCH_INSTRUCTION } from "@/features/web/webSearchAgent";

const OLLAMA = process.env.NYRA_EVAL_OLLAMA;
const MODEL = process.env.NYRA_EVAL_MODEL ?? "qwen3:8b";

type Choice = "browser" | "search" | "screen" | "answer";

// Made-up requests in three languages, and what may answer each one
const CASES: { ask: string; expected: Choice[] }[] = [
  { ask: "Búscame qué significa justicia en Chrome", expected: ["browser"] },
  { ask: "Look up what justice means in Chrome", expected: ["browser"] },
  { ask: "Cherche ce que veut dire justice dans Chrome", expected: ["browser"] },
  { ask: "Abre mi Chrome y busca recetas de pan de centeno", expected: ["browser"] },
  { ask: "Entra a wikipedia.org y busca la palabra justicia", expected: ["browser"] },
  { ask: "Open github.com and take a screenshot of the home page", expected: ["browser"] },
  { ask: "Ouvre YouTube dans le navigateur", expected: ["browser"] },
  { ask: "¿Qué significa justicia?", expected: ["answer", "search"] },
  { ask: "What does photosynthesis mean?", expected: ["answer", "search"] },
  { ask: "¿Qué tiempo hará mañana en Lisboa?", expected: ["search"] },
  { ask: "Quelles sont les nouvelles d'aujourd'hui ?", expected: ["search"] },
  { ask: "Cambia el fondo de pantalla de mi equipo", expected: ["screen"] },
  { ask: "How do I turn on dark mode on my computer? Show me where", expected: ["screen"] },
  { ask: "En la pestaña que tengo abierta en Chrome, haz clic en Iniciar sesión", expected: ["screen"] },
];

// The first tool the reply asks for, by the app's own tags, so a new tool is known here as soon as it exists
function choiceOf(reply: string): Choice {
  const opened = /<nyra-[a-z-]+>/.exec(reply)?.[0];
  const kind = opened && REQUEST_KINDS.find((k) => tagged(k, "").startsWith(opened));
  if (!kind) return "answer";
  if (kind === "search") return "search";
  if (isScreenRequest(kind)) return "screen";
  if (isBrowserRequest(kind)) return "browser";
  return "answer";
}

async function firstChoice(ask: string) {
  const system = [browserPrompt(false, true), screenPrompt(), toolChoicePrompt({ search: true, browser: true, screen: true })]
    .filter(Boolean)
    .join("\n\n");
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: process.env.NYRA_EVAL_THINK === "1",
      options: { temperature: 0 },
      messages: [
        { role: "system", content: system },
        // As in a reply: the search instruction goes at the end of the user's message
        { role: "user", content: `${ask}\n\n${SEARCH_INSTRUCTION}` },
      ],
    }),
  });
  const data = (await response.json()) as { message: { content: string } };
  return choiceOf(data.message.content);
}

describe.skipIf(!OLLAMA)("which tool the model picks first", () => {
  it("picks the one the request asks for, in any language", async () => {
    const results = [];
    for (const { ask, expected } of CASES) {
      const got = await firstChoice(ask);
      results.push({ ask, expected: expected.join(" | "), got, ok: expected.includes(got) });
    }
    const right = results.filter((r) => r.ok).length;
    const lines = results.map((r) => `${r.ok ? "ok " : "NO "} ${r.got.padEnd(8)} (expected ${r.expected})  ${r.ask}`);
    // Vitest keeps a test's console to itself: the table goes to a file too
    if (process.env.NYRA_EVAL_OUT) writeFileSync(process.env.NYRA_EVAL_OUT, `${MODEL}: ${right} of ${results.length}\n${lines.join("\n")}\n`);
    expect(right).toBeGreaterThan(0);
  }, 900_000);
});
