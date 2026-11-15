import { describe, expect, it } from "vitest";
import type { Skill } from "@/features/skills/skills";
import { activeSkillsOf, reservedTokensFor, systemPrompt, withRequestNotes } from "./replyRequest";
import { buildUserRules } from "./userRules";

const skill = (name: string): Skill => ({
  name,
  description: `Descripción de ${name}`,
  license: null,
  compatibility: null,
  metadata: {},
  body: `# ${name}\n\n${"palabra ".repeat(200)}`,
  files: [],
  source: "own",
  editedAt: null,
  adaptedAt: null,
  hasOriginal: false,
  dir: `/skills/${name}`,
});
const rules = buildUserRules({ name: "Marta", occupation: "", instructions: "" });

describe("activeSkillsOf", () => {
  it("keeps the marked skills that still exist", () => {
    expect(activeSkillsOf([skill("a"), skill("b")], ["b", "borrada"]).map((s) => s.name)).toEqual(["b"]);
    expect(activeSkillsOf([skill("a")])).toEqual([]);
  });
});

describe("systemPrompt", () => {
  it("joins the rules and the list of skills, and is empty without either", () => {
    const prompt = systemPrompt(rules, [skill("summarize")]) ?? "";
    expect(prompt).toContain("Marta");
    expect(prompt).toContain("- summarize: Descripción de summarize");
    expect(systemPrompt(null, [])).toBeUndefined();
  });

  it("puts the memories between the rules and the skills", () => {
    const prompt = systemPrompt(rules, [skill("summarize")], "<memories>\n- Usa Tauri\n</memories>") ?? "";
    expect(prompt.indexOf("Marta")).toBeLessThan(prompt.indexOf("Usa Tauri"));
    expect(prompt.indexOf("Usa Tauri")).toBeLessThan(prompt.indexOf("- summarize"));
    expect(systemPrompt(null, [], "- Usa Tauri")).toBe("- Usa Tauri");
  });
});

describe("withRequestNotes", () => {
  it("adds the chosen skill, the date and the rules reminder to the latest user message", () => {
    const [message] = withRequestNotes([{ role: "user", content: "Hola", skill: "summarize" }], [skill("summarize")], rules);
    expect(message.content.startsWith("Hola\n\n<skill name=\"summarize\">")).toBe(true);
    expect(message.content).toContain("<current-date>");
    expect(message.content).toContain("<user-rules-reminder>");
    expect(message.content).toContain("$$…$$");
  });
});

describe("reservedTokensFor", () => {
  it("grows with the skills, the rules and web search", () => {
    const base = reservedTokensFor(null, [], false);
    expect(reservedTokensFor(null, [], true)).toBeGreaterThan(base);
    expect(reservedTokensFor(rules, [], false)).toBeGreaterThan(base);
    expect(reservedTokensFor(null, [skill("a")], false)).toBeGreaterThan(base);
    expect(reservedTokensFor(null, [], false, "- Usa Tauri 2 y React")).toBeGreaterThan(base);
  });
});
